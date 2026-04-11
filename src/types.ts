// src/types.ts
import { Diagnostic } from 'vscode-languageserver/node';

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