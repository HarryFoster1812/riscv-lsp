import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
export interface ParsedInstruction {
    line: number;
    mnemonic: string;
    operands: string[];
    raw: string;
}

export interface ParsedLabel {
    name: string;
    line: number;
}
function extractIncludedLabels(filePath: string, labels: Map<string, ParsedLabel>, visited: Set<string>) {
    // Prevent infinite loops if files include each other
    if (!fs.existsSync(filePath) || visited.has(filePath)) return;
    visited.add(filePath);

    try {
        const text = fs.readFileSync(filePath, 'utf-8');
        const lines = text.split(/\r?\n/);
        
        const labelRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)(?:\s*:|\s*(?:#|;|$))/;
        const defDirectiveRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s+(defw|defb|defs)\s+([^#;]+)/;
        const includeRegex = /^\s*include\s+([^\s#;]+)/;
        const standaloneMnemonics = ['ret', 'nop', 'ecall', 'ebreak'];

        for (const line of lines) {
            if (!line) continue;

            // 1. Follow nested includes
            const incMatch = line.match(includeRegex);
            if (incMatch) {
                const incPath = path.resolve(path.dirname(filePath), incMatch[1]);
                extractIncludedLabels(incPath, labels, visited);
                continue;
            }

            // 2. Extract Data Directives
            const defMatch = line.match(defDirectiveRegex);
            if (defMatch && !labels.has(defMatch[1])) {
                labels.set(defMatch[1], { name: defMatch[1], line: -1 }); // line -1 indicates external label
                continue;
            }

            // 3. Extract Standard Labels
            const labelMatch = line.match(labelRegex);
            if (labelMatch && labelMatch[1] && !standaloneMnemonics.includes(labelMatch[1].toLowerCase())) {
                if (!labels.has(labelMatch[1])) {
                    labels.set(labelMatch[1], { name: labelMatch[1], line: -1 });
                }
            }
        }
    } catch (e) {
        // Silently ignore unreadable files so the LSP doesn't crash
    }
}

export function analyzeText(text: string, documentUri?: string): Diagnostic[] {
    const lines = text.split(/\r?\n/);
    const diagnostics: Diagnostic[] = [];

    const labels: Map<string, ParsedLabel> = new Map();
    const instructions: ParsedInstruction[] = [];
    const jumpTargets: { label: string, line: number, range: any }[] = [];
    
    let baseDir = '';
    const visitedIncludes = new Set<string>();
    
    if (documentUri && documentUri.startsWith('file://')) {
        try {
            const basePath = fileURLToPath(documentUri);
            baseDir = path.dirname(basePath);
            visitedIncludes.add(basePath); // Add self to prevent self-inclusion
        } catch (e) {}
    }

    // --- Phase 1: Parsing ---
    const labelRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)(?:\s*:|\s*(?:#|;|$))/;
    const instRegex = /^\s*([a-zA-Z0-9.]+)(?:\s+([^#;]+))?/; 
    const defDirectiveRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s+(defw|defb|defs)\s+([^#;]+)/; 
    const includeRegex = /^\s*include\s+([^\s#;]+)/;
    const standaloneMnemonics = ['ret', 'nop', 'ecall', 'ebreak'];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line === undefined) continue;

        // --- Process Includes ---
        const incMatch = line.match(includeRegex);
        if (incMatch) {
            const incFile = incMatch[1];
            const startChar = line.indexOf(incFile);
            const endChar = startChar + incFile.length;
            
            // If the current file hasn't been saved yet, we don't have a working directory
            if (!baseDir) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: i, character: startChar },
                        end: { line: i, character: endChar }
                    },
                    message: `Cannot resolve relative path: Save this file to disk first.`,
                    source: 'RISC-V LSP'
                });
                continue;
            }

            // path.resolve automatically handles ../ and ./ syntax
            const fullPath = path.resolve(baseDir, incFile);

            if (!fs.existsSync(fullPath)) {
                // File doesn't exist! Throw a red squiggly error.
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: { line: i, character: startChar },
                        end: { line: i, character: endChar }
                    },
                    message: `Included file not found: '${incFile}'`,
                    source: 'RISC-V LSP'
                });
            } else {
                // File exists, extract its labels!
                extractIncludedLabels(fullPath, labels, visitedIncludes);
            }
            continue;
        }

        // --- 1. Process Custom Data Directives (defw / defb) ---
        const defMatch = line.match(defDirectiveRegex);
        if (defMatch) {
            const potentialLabel = defMatch[1];
            const directive = defMatch[2]; 
            const expression = defMatch[3]; 

            if (labels.has(potentialLabel)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: { start: { line: i, character: lines[i].indexOf(potentialLabel) }, end: { line: i, character: lines[i].indexOf(potentialLabel) + potentialLabel.length } },
                    message: `Duplicate label: '${potentialLabel}' has already been defined.`,
                    source: 'RISC-V LSP'
                });
            } else {
                labels.set(potentialLabel, { name: potentialLabel, line: i });
            }

            const expTokenRegex = /("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b0x[0-9a-fA-F]+\b)|(\b\d+\b)|([a-zA-Z_.][a-zA-Z0-9_.]*)/g;
            let tokenMatch;
            const expressionStartIdx = lines[i].indexOf(expression);

            while ((tokenMatch = expTokenRegex.exec(expression)) !== null) {
                if (tokenMatch[5]) {
                    const token = tokenMatch[5];
                    const tokenStartIdx = expressionStartIdx + tokenMatch.index;
                    
                    const isReg = /^x([0-9]|[1-2][0-9]|3[0-1])$/.test(token) || 
                                  /^(zero|ra|sp|gp|tp|t[0-6]|s[0-9]|s1[0-1]|a[0-7])$/.test(token);

                    if (!isReg) {
                        jumpTargets.push({
                            label: token, line: i,
                            range: { start: { line: i, character: tokenStartIdx }, end: { line: i, character: tokenStartIdx + token.length } }
                        });
                    }
                }
            }
            continue; 
        }
        
        // --- 2. Extract Standard Labels ---
        const labelMatch = line.match(labelRegex);
        if (labelMatch && labelMatch[1]) {
            const potentialLabel = labelMatch[1];
            if (!standaloneMnemonics.includes(potentialLabel.toLowerCase())) {
                if (labels.has(potentialLabel)) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: { start: { line: i, character: lines[i].indexOf(potentialLabel) }, end: { line: i, character: lines[i].indexOf(potentialLabel) + potentialLabel.length } },
                        message: `Duplicate label: '${potentialLabel}' has already been defined.`,
                        source: 'RISC-V LSP'
                    });
                } else {
                    labels.set(potentialLabel, { name: potentialLabel, line: i });
                }
                line = line.substring(labelMatch[0].length); 
            }
        }

        // --- 3. Extract Instructions ---
        const instMatch = line.match(instRegex);
        if (instMatch && instMatch[1]) {
            const mnemonic = instMatch[1].toLowerCase();
            const operandStr = instMatch[2] || "";
            const operands = operandStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
            
            instructions.push({ line: i, mnemonic, operands, raw: line });

            const labelReferencingMnemonics = ['jal', 'j', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'call', 'beqz', 'bnez', 'tail', 'la'];
            if (labelReferencingMnemonics.includes(mnemonic)) {
                const targetLabel = operands[operands.length - 1];
                if (targetLabel && !targetLabel.includes('(')) { 
                    jumpTargets.push({ 
                        label: targetLabel, line: i,
                        range: { start: { line: i, character: lines[i].indexOf(targetLabel) }, end: { line: i, character: lines[i].indexOf(targetLabel) + targetLabel.length } }
                    });
                }
            }
        }
    }

    checkStackTracking(instructions, labels, diagnostics);
    checkMemoryAlignment(instructions, diagnostics);
    checkLabelResolution(jumpTargets, labels, diagnostics);

    return diagnostics;
}

function checkStackTracking(instructions: ParsedInstruction[], labels: Map<string, ParsedLabel>, diagnostics: Diagnostic[]) {
    let currentStackOffset = 0;
    
    // Map to track the net push/pop count for individual registers
    const pushedRegisters = new Map<string, number>();

    // Matches base registers in both standard "0(sp)" and lab "[sp]" syntaxes
    const baseRegRegex = /(?:\[|\()(.*?)(?:\]|\))/;

    for (const inst of instructions) {
        // Reset tracking at the start of a new label (function boundary)
        const isAtLabel = Array.from(labels.values()).some(l => l.line === inst.line);
        if (isAtLabel) {
            currentStackOffset = 0;
            pushedRegisters.clear();
        }

        // 1. Track arithmetic stack pointer changes (addi & subi)
        if ((inst.mnemonic === 'addi' || inst.mnemonic === 'subi') && inst.operands[0] === 'sp' && inst.operands[1] === 'sp') {
            const immStr = inst.operands[2];
            if (immStr) {
                const imm = parseInt(immStr);
                if (!isNaN(imm)) {
                    if (inst.mnemonic === 'addi') {
                        currentStackOffset += imm;
                    } else if (inst.mnemonic === 'subi') {
                        currentStackOffset -= imm; // subi subtracts the immediate 
                    }
                }
            }
        }

        // 2. Track Register Pushes (Store) and Pops (Load)
        const isStore = inst.mnemonic.startsWith('s') && ['sb', 'sh', 'sw', 'sd'].includes(inst.mnemonic);
        const isLoad = inst.mnemonic.startsWith('l') && ['lb', 'lh', 'lw', 'ld', 'lbu', 'lhu'].includes(inst.mnemonic);

        if (isStore || isLoad) {
            const targetReg = inst.operands[0];
            const memOp = inst.operands[inst.operands.length - 1]; // The memory address is usually the last operand
            
            if (targetReg && memOp) {
                const match = memOp.match(baseRegRegex);
                const baseReg = match ? match[1].trim() : null;

                // Check if the memory operation is hitting the stack pointer (x2 or sp) [cite: 31]
                if (baseReg === 'sp' || baseReg === 'x2') {
                    const currentCount = pushedRegisters.get(targetReg) || 0;
                    if (isStore) {
                        pushedRegisters.set(targetReg, currentCount + 1); // Pushed to stack
                    } else if (isLoad) {
                        pushedRegisters.set(targetReg, currentCount - 1); // Popped from stack
                    }
                }
            }
        }

        // 3. Check for imbalances upon returning from the function
        if (inst.mnemonic === 'ret' || (inst.mnemonic === 'jalr' && inst.operands[0] === 'x0' && inst.operands[2] === '0(ra)')) {
            
            // Check the numerical stack offset
            if (currentStackOffset !== 0) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: inst.line, character: 0 },
                        end: { line: inst.line, character: inst.raw.length }
                    },
                    message: `Stack pointer mismatch: 'sp' offset is ${currentStackOffset} at return. Did you forget to restore it?`,
                    source: 'RISC-V LSP'
                });
            }

            // Check if any registers were left abandoned on the stack
            for (const [reg, count] of pushedRegisters.entries()) {
                if (count > 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: { line: inst.line, character: 0 },
                            end: { line: inst.line, character: inst.raw.length }
                        },
                        message: `Unbalanced stack: Register '${reg}' was pushed ${count} time(s) but never popped before return.`,
                        source: 'RISC-V LSP'
                    });
                } else if (count < 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: { line: inst.line, character: 0 },
                            end: { line: inst.line, character: inst.raw.length }
                        },
                        message: `Unbalanced stack: Register '${reg}' was popped ${Math.abs(count)} more time(s) than it was pushed.`,
                        source: 'RISC-V LSP'
                    });
                }
            }
        }
    }
}

function checkMemoryAlignment(instructions: ParsedInstruction[], diagnostics: Diagnostic[]) {
    const memRegex = /^(-?\d+)\s*\(([^)]+)\)/; 

    for (const inst of instructions) {
        let requiredAlignment = 0;
        if (['lw', 'sw'].includes(inst.mnemonic)) requiredAlignment = 4;
        else if (['lh', 'lhu', 'sh'].includes(inst.mnemonic)) requiredAlignment = 2;

        if (requiredAlignment > 0) {
            const memOp = inst.operands[inst.operands.length - 1];
            if (!memOp) continue; // TS safety check

            const match = memOp.match(memRegex);
            if (match && match[1]) {
                const offset = parseInt(match[1]);
                if (!isNaN(offset) && offset % requiredAlignment !== 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
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

function checkLabelResolution(jumpTargets: { label: string, line: number, range: any }[], labels: Map<string, ParsedLabel>, diagnostics: Diagnostic[]) {
    for (const target of jumpTargets) {
        if (/^\d+$/.test(target.label)) continue;

        if (!labels.has(target.label)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: target.range,
                message: `RISC-V Undefined label: '${target.label}'`,
                source: 'RISC-V LSP'
            });
        }
    }
}
