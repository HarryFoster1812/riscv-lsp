import * as fs from 'fs';
import * as path from 'path';
import { analyzeText } from '../src/analyzer';
import { DiagnosticSeverity } from 'vscode-languageserver/node';

describe('RISC-V LSP Diagnostics', () => {

    describe('Passing Tests (Valid Syntax)', () => {
        const passingDir = path.join(__dirname, 'fixtures', 'passing');
        const files = fs.readdirSync(passingDir).filter(f => f.endsWith('.s'));

        test.each(files)('should return 0 diagnostics for %s', (filename) => {
            const filePath = path.join(passingDir, filename);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            
            const diagnostics = analyzeText(fileContent);
            
            // We expect a completely empty array of errors/warnings
            expect(diagnostics.length).toBe(0);
        });
    });

    describe('Failing Tests (Invalid Syntax/Logic)', () => {
        
        test('bad_stack.s should identify unpopped registers and mismatched offsets', () => {
            const filePath = path.join(__dirname, 'fixtures', 'failing', 'bad_stack.s');
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            
            const diagnostics = analyzeText(fileContent);

            // We expect exactly 2 warnings (1 for offset, 1 for unpopped t0)
            expect(diagnostics.length).toBe(2);

            // Check that they are warnings
            expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
            expect(diagnostics[1].severity).toBe(DiagnosticSeverity.Warning);

            // Verify the specific error messages were triggered
            const messages = diagnostics.map(d => d.message);
            expect(messages.some(m => m.includes('offset is -16'))).toBe(true);
            expect(messages.some(m => m.includes("Register 't0' was pushed"))).toBe(true);
        });

    });
});