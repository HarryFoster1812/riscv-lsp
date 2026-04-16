// src/constants.ts
export const labelRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)(?:\s*:|\s*(?=[#;]|$))/;
export const instRegex = /^\s*([a-zA-Z0-9.]+)(?:\s+([^#;]+))?/; 
export const defDirectiveRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s+(defw|defb|defs|equ|EQU)\s+([^#;]+)/;
export const includeRegex = /^\s*include\s+([^\s#;]+)/;
export const structRegex = /^\s*(?:[a-zA-Z_.][a-zA-Z0-9_.]*\s*:?\s+)?struct\b/i;
export const structMemberRegex = /^\s*([a-zA-Z_.][a-zA-Z0-9_.]*)\s*:?\s+(word|alias)\b(?:\s+(\d+))?/i;
export const standaloneMnemonics = ['ret', 'nop', 'ecall', 'ebreak','mret'];
export const labelReferencingMnemonics = ['jal', 'j', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'call', 'beqz', 'bnez', 'tail', 'la', 'li'];
export const CSR_REGISTERS: Record<string, { address: string, description: string }> = {
    'mstatus': { address: '0x300', description: 'Machine STATUS: Collected machine status bits.' },
    'misa': { address: '0x301', description: '(Machine) ISA and extensions: Defines possible/active instruction set.' },
    'mie': { address: '0x304', description: 'Machine Interrupt Enable: Allow individual interrupts.' },
    'mtvec': { address: '0x305', description: 'Machine Trap VECtor: Address jumped to on trap entry.' },
    'mscratch': { address: '0x340', description: 'Machine trap handler SCRATCH: Free for software use.' },
    'mepc': { address: '0x341', description: 'Machine Exception PC: Address of instruction which \'trapped\'.' },
    'mcause': { address: '0x342', description: 'Machine trap CAUSE: Reason for trap.' },
    'mtval': { address: '0x343', description: 'Machine Trap VALue: Trap argument.' },
    'mip': { address: '0x344', description: 'Machine Interrupt Pending: Individual interrupt input states.' },
    'cycle': { address: '0xC00', description: 'Cycle COUNT (low): Low 32 bits (of 64).' },
    'time': { address: '0xC01', description: 'Real TIME clock (low): Low 32 bits (of 64).' },
    'instret': { address: '0xC02', description: 'INSTructions RETired (low): Low 32 bits (of 64).' },
    'cycleh': { address: '0xC80', description: 'CYCLE count High: High 32 bits (of 64).' },
    'timeh': { address: '0xC81', description: 'Real TIME clock High: High 32 bits (of 64).' },
    'instreth': { address: '0xC82', description: 'INSTructions RETired High: High 32 bits (of 64).' }
};
export const CSR_INSTRUCTIONS: Record<string, string> = {
    'csrrw': 'Read and Write CSR (`CSRRW Rd, CSR, Rs`)',
    'csrw': 'Write CSR\n\n*Pseudoinstruction for:* `CSRRW x0, CSR, Rs`',
    'csrr': 'Read CSR\n\n*Pseudoinstruction for:* `CSRRS Rd, CSR, x0`',
    'csrs': 'Set CSR bits\n\n*Pseudoinstruction for:* `CSRRS x0, CSR, Rs`',
    'csrc': 'Clear CSR bits\n\n*Pseudoinstruction for:* `CSRRC x0, CSR, Rs`',
    'csrrs': 'Read and Set CSR bits (`CSRRS Rd, CSR, Rs`)',
    'csrrc': 'Read and Clear CSR bits (`CSRRC Rd, CSR, Rs`)',
    'csrrwi': 'Read and Write CSR using Immediate',
    'csrrsi': 'Read and Set CSR bits using Immediate',
    'csrrci': 'Read and Clear CSR bits using Immediate'
};
export const knownInstructions = new Set([
    'add', 'sub', 'xor', 'or', 'and', 'sll', 'srl', 'sra', 'slt', 'sltu',
    'addi', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai', 'slti', 'sltiu',
    'mul', 'mulh', 'mulsu', 'mulu', 'div', 'divu', 'rem', 'remu',
    'lb', 'lh', 'lw', 'lbu', 'lhu', 'sb', 'sh', 'sw',
    'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'jal', 'jalr',
    'lui', 'auipc', 'ecall', 'ebreak',
    'la', 'li', 'subi', 'nop', 'mv', 'not', 'neg',
    'seqz', 'snez', 'sltz', 'sgtz',
    'beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz',
    'bgt', 'ble', 'bgtu', 'bleu',
    'j', 'jr', 'ret', 'call', 'tail',
    'csrrw', 'csrr', 'csrw', 'csrrs', 'csrs', 'csrrc', 'csrc', 'csrrwi', 'csrrsi', 'csrrci'
]);