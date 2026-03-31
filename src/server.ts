import {
    createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, InitializeParams, InitializeResult,
    Hover, MarkupKind, Location, Position
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeText, ParsedLabel } from './analyzer';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Global state to hold the latest labels so our hover/click functions can access them
let latestLabels = new Map<string, ParsedLabel>();

connection.onInitialize((params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            hoverProvider: true,
            definitionProvider: true  
        }
    };
    return result;
});

documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    
    // Get both diagnostics and our newly mapped labels
    const result = analyzeText(text, textDocument.uri);
    
    latestLabels = result.labels; // Save for hovers and clicks
    
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: result.diagnostics });
}

// --- HELPER: Find the word under the mouse cursor ---
function getWordAtPosition(document: TextDocument, position: Position): string | null {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const line = lines[position.line];
    if (!line) return null;

    const wordRegex = /[a-zA-Z_.][a-zA-Z0-9_.]*/g;
    let match;
    while ((match = wordRegex.exec(line)) !== null) {
        if (position.character >= match.index && position.character <= match.index + match[0].length) {
            return match[0];
        }
    }
    return null;
}

// --- FEATURE 1: Hover Information ---
connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    const label = latestLabels.get(word);
    if (label) {
        // If it's an EQU, show its value. Otherwise, just show that it's a label.
        const markdownText = label.value 
            ? `\`\`\`riscv\n(constant) ${label.name} EQU ${label.value}\n\`\`\``
            : `\`\`\`riscv\n(label) ${label.name}\n\`\`\``;

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: markdownText
            }
        };
    }
    return null;
});

// --- FEATURE 2: Go To Definition (Cmd/Ctrl + Click) ---
connection.onDefinition((params): Location | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    const label = latestLabels.get(word);
    if (label && label.uri) {
        return {
            uri: label.uri,
            range: {
                start: { line: label.line, character: 0 },
                end: { line: label.line, character: label.name.length }
            }
        };
    }
    return null;
});

documents.listen(connection);
connection.listen();