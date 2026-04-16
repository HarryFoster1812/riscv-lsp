// src/analyzer.ts
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// 1. Import our custom modules!
import { ParsedInstruction, ParsedLabel, AnalysisResult } from './types';
import { 
    structRegex, structMemberRegex, includeRegex, defDirectiveRegex, 
    labelRegex, instRegex, standaloneMnemonics, CSR_REGISTERS, knownInstructions 
} from './constants';import { extractIncludedLabels } from './preprocessor';
import { checkStackTracking } from './diagnostics/stackTracker';
import { checkMemoryAlignment } from './diagnostics/memoryAlignment';
import { checkLabelResolution } from './diagnostics/labelResolver';


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
                    const isCsr = token.toLowerCase() in CSR_REGISTERS;
                    if (!isReg && !isCsr) {
                            jumpTargets.push({ 
                                label: token, 
                                line: i,
                                range: { 
                                    start: { line: i, character: tokenStartIdx }, 
                                    end: { line: i, character: tokenStartIdx + token.length } 
                                }
                            });
                        }
                }
            }
            continue; 
        }
        
        // --- 4. Extract Standard Labels ---
        // --- 4. Extract Standard Labels ---
        let labelMatch = line.match(labelRegex);
        let extractedLabel = '';
        let matchLength = 0;

        if (labelMatch && labelMatch[1]) {
            // Standard colon or end-of-line label found
            extractedLabel = labelMatch[1];
            matchLength = labelMatch[0].length;
        } else {
            // Heuristic fallback for colon-less inline labels (e.g., "label add t0")
            const inlineMatch = line.match(/^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s+([a-zA-Z0-9.]+)/i);
            if (inlineMatch && inlineMatch[1] && inlineMatch[2]) {
                if (knownInstructions.has(inlineMatch[2].toLowerCase())) {
                    extractedLabel = inlineMatch[1];
                    // Slice the string exactly where the instruction begins!
                    matchLength = line.indexOf(inlineMatch[2]);
                }
            }
        }

        if (extractedLabel) {
            if (!standaloneMnemonics.includes(extractedLabel.toLowerCase())) {
                if (!labels.has(extractedLabel)) {
                    labels.set(extractedLabel, { 
                        name: extractedLabel, 
                        line: i, 
                        uri: documentUri || '',
                        type: 'label'
                    });
                } else {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: { start: { line: i, character: lines[i].indexOf(extractedLabel) }, end: { line: i, character: lines[i].indexOf(extractedLabel) + extractedLabel.length } },
                        message: `Duplicate label: '${extractedLabel}' has already been defined.`,
                        source: 'RISC-V LSP'
                    });
                }
                line = line.substring(matchLength); 
            }
        }


        // --- 5. Extract Instructions ---
        const instMatch = line.match(instRegex);
        if (instMatch && instMatch[1]) {
            const mnemonic = instMatch[1].toLowerCase();
            const operandStr = instMatch[2] || "";
            const operands = operandStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
            
            instructions.push({ line: i, mnemonic, operands, raw: line });

            if (operandStr) {
                // A fresh regex instance prevents /g state leaks between lines
                const expTokenRegex = /("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b0x[0-9a-f_]+\b|\$[0-9a-f_]+\b|\b0b[01_]+\b|:[01_]+\b|@[0-7_]+\b)|(\b\d[\d_]*\b)|([a-z_.][a-z0-9_.]*)/gi;                
                let tokenMatch;
                const operandStartIdx = lines[i].indexOf(operandStr);

                // Scan the entire operand string for valid tokens
                // Scan the entire operand string for valid tokens
                while ((tokenMatch = expTokenRegex.exec(operandStr)) !== null) {
                    if (tokenMatch[5]) { // Group 5 captures text identifiers
                        const token = tokenMatch[5];
                        const tokenStartIdx = operandStartIdx + tokenMatch.index;
                        
                        // 1. Check if it's a standard RISC-V register
                        const isReg = /^x([0-9]|[1-2][0-9]|3[0-1])$/.test(token) || 
                                      /^(zero|ra|sp|gp|tp|t[0-6]|s[0-9]|s1[0-1]|a[0-7])$/i.test(token);

                        // 2. Check if it's a hardware CSR
                        const isCsr = token.toLowerCase() in CSR_REGISTERS;

                        // 3. If it's NOT a register AND NOT a CSR, it must be a label, offset, or constant!
                        if (!isReg && !isCsr) {
                            jumpTargets.push({ 
                                label: token, 
                                line: i,
                                range: { 
                                    start: { line: i, character: tokenStartIdx }, 
                                    end: { line: i, character: tokenStartIdx + token.length } 
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    checkStackTracking(instructions, labels, diagnostics);
    checkMemoryAlignment(instructions, diagnostics);
    checkLabelResolution(jumpTargets, labels, diagnostics);

    return { diagnostics, labels };
}




