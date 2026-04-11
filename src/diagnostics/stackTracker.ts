// src/diagnostics/stackTracker.ts
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { ParsedInstruction, ParsedLabel } from '../types';

export function checkStackTracking(instructions: ParsedInstruction[], labels: Map<string, ParsedLabel>, diagnostics: Diagnostic[]) {
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