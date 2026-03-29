import {
    createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, InitializeParams, InitializeResult
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Import our pure text analyzer!
import { analyzeText } from './analyzer';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities: { textDocumentSync: TextDocumentSyncKind.Incremental }
    };
    return result;
});

documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    
    // Hand off the raw text to our analyzer
    const diagnostics = analyzeText(text);
    
    // Send the results back to VS Code
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

documents.listen(connection);
connection.listen();