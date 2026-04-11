// src/constants.ts
export const labelRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)(?:\s*:|\s*(?:#|;|$))/;
export const instRegex = /^\s*([a-zA-Z0-9.]+)(?:\s+([^#;]+))?/; 
export const defDirectiveRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s+(defw|defb|defs|equ|EQU)\s+([^#;]+)/;
export const includeRegex = /^\s*include\s+([^\s#;]+)/;
export const structRegex = /^\s*(?:[a-zA-Z_.][a-zA-Z0-9_.]*\s*:?\s+)?struct\b/i;
export const structMemberRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s*:?\s+(word|alias)\b(?:\s+(\d+))?/i;
export const standaloneMnemonics = ['ret', 'nop', 'ecall', 'ebreak'];
export const labelReferencingMnemonics = ['jal', 'j', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'call', 'beqz', 'bnez', 'tail', 'la', 'li'];