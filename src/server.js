"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
// Create a simple text document manager.
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
connection.onInitialize((params) => {
    const result = {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
        }
    };
    return result;
});
// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});
/**
 * Main diagnostic logic.
 */
async function validateTextDocument(textDocument) {
    const text = textDocument.getText();
    const lines = text.split(/\r?\n/);
    const diagnostics = [];
    const labels = new Map();
    const instructions = [];
    const jumpTargets = [];
    // --- Phase 1: Parsing ---
    // Regular expressions for RISC-V assembly components
    const labelRegex = /^([a-zA-Z_.][a-zA-Z0-9_.]*):/;
    const instRegex = /^\s*([a-z]+)(?:\s+([^#;]+))?/; // Basic mnemonic and operands, ignoring comments
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 1. Extract Labels
        const labelMatch = line.match(labelRegex);
        if (labelMatch) {
            labels.set(labelMatch[1], { name: labelMatch[1], line: i });
        }
        // 2. Extract Instructions
        const instMatch = line.match(instRegex);
        if (instMatch) {
            const mnemonic = instMatch[1];
            const operandStr = instMatch[2] || "";
            const operands = operandStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
            instructions.push({
                line: i,
                mnemonic,
                operands,
                raw: line
            });
            // 3. Collect potential jump/branch targets for resolution check
            // Common jump/branch mnemonics: jal, j, beq, bne, blt, bge, bltu, bgeu, call, beqz, bnez, etc.
            const jumpMnemonics = ['jal', 'j', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'call', 'beqz', 'bnez'];
            if (jumpMnemonics.includes(mnemonic)) {
                // For branches, target is usually the last operand. For 'j' and 'call', it's the first.
                const targetLabel = operands[operands.length - 1];
                if (targetLabel && !targetLabel.includes('(')) { // Avoid registers like (ra)
                    jumpTargets.push({
                        label: targetLabel,
                        line: i,
                        range: {
                            start: { line: i, character: line.indexOf(targetLabel) },
                            end: { line: i, character: line.indexOf(targetLabel) + targetLabel.length }
                        }
                    });
                }
            }
        }
    }
    // --- Phase 2: Diagnostic Checks ---
    checkStackTracking(instructions, labels, diagnostics);
    checkMemoryAlignment(instructions, diagnostics);
    checkLabelResolution(jumpTargets, labels, diagnostics);
    // Send the computed diagnostics to VSCode.
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
/**
 * Requirement 1: Stack Frame Tracking (Push/Pop Matching)
 * Flags a warning if a function (defined by a label) exits without restoring 'sp'.
 */
function checkStackTracking(instructions, labels, diagnostics) {
    let currentStackOffset = 0;
    let lastLabelLine = -1;
    // Simple heuristic: We track 'sp' changes within blocks delimited by labels.
    // In assembly, labels often mark function entry points.
    for (const inst of instructions) {
        // Reset tracking on a new label (approximate function boundary)
        const isAtLabel = Array.from(labels.values()).some(l => l.line === inst.line);
        if (isAtLabel) {
            // If we were tracking a previous block and it didn't return, 
            // we don't necessarily warn here because of fall-throughs.
            // But for simplicity, we reset the offset for the new "function".
            currentStackOffset = 0;
            lastLabelLine = inst.line;
        }
        // Track: addi sp, sp, -imm (push) and addi sp, sp, imm (pop)
        if (inst.mnemonic === 'addi' && inst.operands[0] === 'sp' && inst.operands[1] === 'sp') {
            const imm = parseInt(inst.operands[2]);
            if (!isNaN(imm)) {
                currentStackOffset += imm;
            }
        }
        // Check on return: ret (pseudo-instruction for jalr x0, 0(ra))
        if (inst.mnemonic === 'ret' || (inst.mnemonic === 'jalr' && inst.operands[0] === 'x0' && inst.operands[2] === '0(ra)')) {
            if (currentStackOffset !== 0) {
                diagnostics.push({
                    severity: node_1.DiagnosticSeverity.Warning,
                    range: {
                        start: { line: inst.line, character: 0 },
                        end: { line: inst.line, character: inst.raw.length }
                    },
                    message: `Stack pointer mismatch: 'sp' offset is ${currentStackOffset} at return. Did you forget to restore it?`,
                    source: 'RISC-V LSP'
                });
            }
        }
    }
}
/**
 * Requirement 2: Memory Alignment Checking
 * Warns if static immediate offsets for lw/sw (mod 4) or lh/sh (mod 2) are misaligned.
 */
function checkMemoryAlignment(instructions, diagnostics) {
    const memRegex = /^(-?\d+)\s*\(([^)]+)\)/; // matches "offset(reg)"
    for (const inst of instructions) {
        let requiredAlignment = 0;
        if (['lw', 'sw'].includes(inst.mnemonic))
            requiredAlignment = 4;
        else if (['lh', 'lhu', 'sh'].includes(inst.mnemonic))
            requiredAlignment = 2;
        if (requiredAlignment > 0) {
            // Memory operand is usually the last one: lw rd, imm(rs1)
            const memOp = inst.operands[inst.operands.length - 1];
            const match = memOp.match(memRegex);
            if (match) {
                const offset = parseInt(match[1]);
                if (!isNaN(offset) && offset % requiredAlignment !== 0) {
                    diagnostics.push({
                        severity: node_1.DiagnosticSeverity.Warning,
                        range: {
                            start: { line: inst.line, character: inst.raw.indexOf(memOp) },
                            end: { line: inst.line, character: inst.raw.indexOf(memOp) + memOp.length }
                        },
                        message: `Misaligned memory access: Offset ${offset} is not a multiple of ${requiredAlignment} for '${inst.mnemonic}'.`,
                        source: 'RISC-V LSP'
                    });
                }
            }
        }
    }
}
/**
 * Requirement 3: Label Definition and Resolution
 * Flags an error if a branch or jump targets an undefined label.
 */
function checkLabelResolution(jumpTargets, labels, diagnostics) {
    for (const target of jumpTargets) {
        // Ignore numeric offsets/registers sometimes found in complex jumps
        if (/^\d+$/.test(target.label))
            continue;
        if (!labels.has(target.label)) {
            diagnostics.push({
                severity: node_1.DiagnosticSeverity.Error,
                range: target.range,
                message: `Undefined label: '${target.label}'`,
                source: 'RISC-V LSP'
            });
        }
    }
}
// Listen on the connection
connection.listen();
//# sourceMappingURL=server.js.map