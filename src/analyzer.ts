import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export interface ParsedInstruction {
    line: number;
    mnemonic: string;
    operands: string[];
    raw: string;
}

export interface ParsedLabel {
    name: string;
    line: number;
    uri: string;
    value?: string;
    type: 'label' | 'constant' | 'offset';
}

export interface AnalysisResult {
    diagnostics: Diagnostic[];
    labels: Map<string, ParsedLabel>;
}

// --- Shared Regexes ---
const labelRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)(?:\s*:|\s*(?:#|;|$))/;
const instRegex = /^\s*([a-zA-Z0-9.]+)(?:\s+([^#;]+))?/; 
const defDirectiveRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s+(defw|defb|defs|equ|EQU)\s+([^#;]+)/;
const includeRegex = /^\s*include\s+([^\s#;]+)/;
const structRegex = /^\s*(?:[a-zA-Z_.][a-zA-Z0-9_.]*\s*:?\s+)?struct\b/i;
const structMemberRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s*:?\s+(word|alias)\b(?:\s+(\d+))?/i;
const standaloneMnemonics = ['ret', 'nop', 'ecall', 'ebreak'];

function extractIncludedLabels(filePath: string, labels: Map<string, ParsedLabel>, visited: Set<string>) {
    if (!fs.existsSync(filePath) || visited.has(filePath)) return;
    visited.add(filePath);

    try {
        const text = fs.readFileSync(filePath, 'utf-8');
        const lines = text.split(/\r?\n/);
        
        let inStruct = false;
        let currentOffset = 0;

        for (const line of lines) {
            if (!line) continue;

            // --- 1. Struct State Machine ---
            if (structRegex.test(line)) {
                inStruct = true;
                currentOffset = 0;
                continue;
            }

            if (inStruct) {
                const structMatch = line.match(structMemberRegex);
                if (structMatch) {
                    const labelName = structMatch[1];
                    const dataType = structMatch[2].toLowerCase();
                    const count = structMatch[3] ? parseInt(structMatch[3], 10) : 1;

                    if (!labels.has(labelName)) {
                        labels.set(labelName, {
                            name: labelName,
                            line: lines.indexOf(line),
                            uri: pathToFileURL(filePath).toString(),
                            value: currentOffset.toString(),
                            type: 'offset'
                        });
                    }

                    if (dataType === 'word') currentOffset += count * 4;
                    continue;
                } else {
                    const trimmed = line.trim();
                    if (trimmed !== '' && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
                        inStruct = false;
                    }
                }
            }

            // --- 2. Follow nested includes ---
            const incMatch = line.match(includeRegex);
            if (incMatch) {
                const incPath = path.resolve(path.dirname(filePath), incMatch[1]);
                extractIncludedLabels(incPath, labels, visited);
                continue;
            }

            // --- 3. Extract Data Directives ---
            const defMatch = line.match(defDirectiveRegex);
            if (defMatch && !labels.has(defMatch[1])) {
                const isEqu = defMatch[2].toLowerCase() === 'equ';
                labels.set(defMatch[1], { 
                    name: defMatch[1], 
                    line: lines.indexOf(line), 
                    uri: pathToFileURL(filePath).toString(), 
                    value: isEqu ? defMatch[3].trim() : undefined,
                    type: isEqu ? 'constant' : 'label'
                });
                continue;
            }

            // --- 4. Extract Standard Labels ---
            const labelMatch = line.match(labelRegex);
            if (labelMatch && labelMatch[1] && !standaloneMnemonics.includes(labelMatch[1].toLowerCase())) {
                if (!labels.has(labelMatch[1])) {
                    labels.set(labelMatch[1], { 
                        name: labelMatch[1], 
                        line: lines.indexOf(line), 
                        uri: pathToFileURL(filePath).toString(),
                        type: 'label'
                    });
                }
            }
        }
    } catch (e) {}
}

export function analyzeText(text: string, documentUri?: string): AnalysisResult {
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
            visitedIncludes.add(basePath);
        } catch (e) {}
    }

    // CRITICAL FIX: These must live outside the loop!
    let inStruct = false;
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line === undefined) continue;
        
        // --- 1. Struct State Machine ---
        if (structRegex.test(line)) {
            inStruct = true;
            currentOffset = 0;
            continue;
        }

        if (inStruct) {
            const structMatch = line.match(structMemberRegex);
            if (structMatch) {
                const labelName = structMatch[1];
                const dataType = structMatch[2].toLowerCase();
                const count = structMatch[3] ? parseInt(structMatch[3], 10) : 1;

                if (!labels.has(labelName)) {
                    labels.set(labelName, {
                        name: labelName,
                        line: i,
                        uri: documentUri || '',
                        value: currentOffset.toString(),
                        type: 'offset'
                    });
                }

                if (dataType === 'word') currentOffset += count * 4;
                continue; // CRITICAL: Skip the rest of the checks for this line
            } else {
                const trimmed = line.trim();
                if (trimmed !== '' && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
                    inStruct = false;
                }
            }
        }

        // --- 2. Process Includes ---
        const incMatch = line.match(includeRegex);
        if (incMatch) {
            const incFile = incMatch[1];
            const startChar = line.indexOf(incFile);
            const endChar = startChar + incFile.length;
            
            if (!baseDir) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: { start: { line: i, character: startChar }, end: { line: i, character: endChar } },
                    message: `Cannot resolve relative path: Save this file to disk first.`,
                    source: 'RISC-V LSP'
                });
                continue;
            }

            const fullPath = path.resolve(baseDir, incFile);
            if (!fs.existsSync(fullPath)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: { start: { line: i, character: startChar }, end: { line: i, character: endChar } },
                    message: `Included file not found: '${incFile}'`,
                    source: 'RISC-V LSP'
                });
            } else {
                extractIncludedLabels(fullPath, labels, visitedIncludes);
            }
            continue;
        }

        // --- 3. Process Custom Data Directives (defw / defb / EQU) ---
        const defMatch = line.match(defDirectiveRegex);
        if (defMatch) {
            const potentialLabel = defMatch[1];
            const directive = defMatch[2]; 
            const expression = defMatch[3]; 

            if (!labels.has(potentialLabel)) {
                const isEqu = directive.toLowerCase() === 'equ';
                labels.set(potentialLabel, { 
                    name: potentialLabel, 
                    line: i, 
                    uri: documentUri || '', 
                    value: isEqu ? expression.trim() : undefined,
                    type: isEqu ? 'constant' : 'label'
                });
            } else {
                // FIXED: Push diagnostic instead of silently overwriting!
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: { start: { line: i, character: lines[i].indexOf(potentialLabel) }, end: { line: i, character: lines[i].indexOf(potentialLabel) + potentialLabel.length } },
                    message: `Duplicate label: '${potentialLabel}' has already been defined.`,
                    source: 'RISC-V LSP'
                });
            }

            const expTokenRegex = /("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b0x[0-9a-fA-F_]+\b|\$[0-9a-fA-F_]+\b|\b0b[01_]+\b|:[01_]+\b|@[0-7_]+\b)|(\b\d[\d_]*\b)|([a-zA-Z_.][a-zA-Z0-9_.]*)/g;
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
        
        // --- 4. Extract Standard Labels ---
        const labelMatch = line.match(labelRegex);
        if (labelMatch && labelMatch[1]) {
            const potentialLabel = labelMatch[1];
            if (!standaloneMnemonics.includes(potentialLabel.toLowerCase())) {
                if (!labels.has(potentialLabel)) {
                    labels.set(potentialLabel, { 
                        name: potentialLabel, 
                        line: i, 
                        uri: documentUri || '',
                        type: 'label'
                    });
                } else {
                     // FIXED: Push diagnostic instead of silently overwriting!
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: { start: { line: i, character: lines[i].indexOf(potentialLabel) }, end: { line: i, character: lines[i].indexOf(potentialLabel) + potentialLabel.length } },
                        message: `Duplicate label: '${potentialLabel}' has already been defined.`,
                        source: 'RISC-V LSP'
                    });
                }
                line = line.substring(labelMatch[0].length); 
            }
        }

        // --- 5. Extract Instructions ---
        const instMatch = line.match(instRegex);
        if (instMatch && instMatch[1]) {
            const mnemonic = instMatch[1].toLowerCase();
            const operandStr = instMatch[2] || "";
            const operands = operandStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
            
            instructions.push({ line: i, mnemonic, operands, raw: line });

            const labelReferencingMnemonics = ['jal', 'j', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'call', 'beqz', 'bnez', 'tail', 'la','li'];
            if (labelReferencingMnemonics.includes(mnemonic)) {
                const targetLabel = operands[operands.length - 1];
                const isNumber = /^(0x[0-9a-fA-F_]+|\$[0-9a-fA-F_]+|0b[01_]+|:[01_]+|@[0-7_]+|-?\d[\d_]*)$/i.test(targetLabel);
                
                if (!isNumber) {
                    jumpTargets.push({ 
                        label: targetLabel, 
                        line: i,
                        range: { 
                            start: { line: i, character: lines[i].indexOf(targetLabel) }, 
                            end: { line: i, character: lines[i].indexOf(targetLabel) + targetLabel.length } 
                        }
                    });
                }
            }
        }
    }

    checkStackTracking(instructions, labels, diagnostics);
    checkMemoryAlignment(instructions, diagnostics);
    checkLabelResolution(jumpTargets, labels, diagnostics);

    return { diagnostics, labels };
}

function checkStackTracking(instructions: ParsedInstruction[], labels: Map<string, ParsedLabel>, diagnostics: Diagnostic[]) {
    let currentStackOffset = 0;
    const pushedRegisters = new Map<string, number>();
    const baseRegRegex = /(?:\[|\()(.*?)(?:\]|\))/;

    for (const inst of instructions) {
        const isAtLabel = Array.from(labels.values()).some(l => l.line === inst.line);
        if (isAtLabel) {
            currentStackOffset = 0;
            pushedRegisters.clear();
        }

        if ((inst.mnemonic === 'addi' || inst.mnemonic === 'subi') && inst.operands[0] === 'sp' && inst.operands[1] === 'sp') {
            const immStr = inst.operands[2];
            if (immStr) {
                const imm = parseInt(immStr);
                if (!isNaN(imm)) {
                    if (inst.mnemonic === 'addi') currentStackOffset += imm;
                    else if (inst.mnemonic === 'subi') currentStackOffset -= imm;
                }
            }
        }

        const isStore = inst.mnemonic.startsWith('s') && ['sb', 'sh', 'sw', 'sd'].includes(inst.mnemonic);
        const isLoad = inst.mnemonic.startsWith('l') && ['lb', 'lh', 'lw', 'ld', 'lbu', 'lhu'].includes(inst.mnemonic);

        if (isStore || isLoad) {
            const targetReg = inst.operands[0];
            const memOp = inst.operands[inst.operands.length - 1];
            
            if (targetReg && memOp) {
                const match = memOp.match(baseRegRegex);
                const baseReg = match ? match[1].trim() : null;

                if (baseReg === 'sp' || baseReg === 'x2') {
                    const currentCount = pushedRegisters.get(targetReg) || 0;
                    if (isStore) pushedRegisters.set(targetReg, currentCount + 1);
                    else if (isLoad) pushedRegisters.set(targetReg, currentCount - 1);
                }
            }
        }

        if (inst.mnemonic === 'ret' || (inst.mnemonic === 'jalr' && inst.operands[0] === 'x0' && inst.operands[2] === '0(ra)')) {
            if (currentStackOffset !== 0) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: { start: { line: inst.line, character: 0 }, end: { line: inst.line, character: inst.raw.length } },
                    message: `Stack pointer mismatch: 'sp' offset is ${currentStackOffset} at return. Did you forget to restore it?`,
                    source: 'RISC-V LSP'
                });
            }

            for (const [reg, count] of pushedRegisters.entries()) {
                if (count > 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: { start: { line: inst.line, character: 0 }, end: { line: inst.line, character: inst.raw.length } },
                        message: `Unbalanced stack: Register '${reg}' was pushed ${count} time(s) but never popped before return.`,
                        source: 'RISC-V LSP'
                    });
                } else if (count < 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: { start: { line: inst.line, character: 0 }, end: { line: inst.line, character: inst.raw.length } },
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
            if (!memOp) continue; 

            const match = memOp.match(memRegex);
            if (match && match[1]) {
                const offset = parseInt(match[1]);
                if (!isNaN(offset) && offset % requiredAlignment !== 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: { start: { line: inst.line, character: inst.raw.indexOf(memOp) }, end: { line: inst.line, character: inst.raw.indexOf(memOp) + memOp.length } },
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