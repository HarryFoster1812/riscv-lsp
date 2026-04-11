// src/diagnostics/memoryAllignment.ts
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { ParsedInstruction, ParsedLabel } from '../types';

export function checkMemoryAlignment(instructions: ParsedInstruction[], diagnostics: Diagnostic[]) {
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