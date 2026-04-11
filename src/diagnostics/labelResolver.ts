// src/diagnostics/labelResolver.ts
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { ParsedInstruction, ParsedLabel } from '../types';


export function checkLabelResolution(jumpTargets: { label: string, line: number, range: any }[], labels: Map<string, ParsedLabel>, diagnostics: Diagnostic[]) {
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