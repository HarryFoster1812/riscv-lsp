// src/analyzer.ts
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// 1. Import our custom modules!
import { ParsedInstruction, ParsedLabel, AnalysisResult } from './types';
import { structRegex, structMemberRegex, includeRegex, defDirectiveRegex, labelRegex, instRegex, labelReferencingMnemonics, standaloneMnemonics } from './constants';
import { extractIncludedLabels } from './preprocessor';
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




