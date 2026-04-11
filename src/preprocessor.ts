// src/preprocessor.ts
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ParsedLabel } from './types';
import { structRegex, structMemberRegex, includeRegex, defDirectiveRegex, labelRegex, standaloneMnemonics } from './constants';

export function extractIncludedLabels(filePath: string, labels: Map<string, ParsedLabel>, visited: Set<string>) {
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