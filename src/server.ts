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
    
    // Pass the URI so the analyzer knows where on the hard drive this file lives
    const diagnostics = analyzeText(text, textDocument.uri);
    
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

documents.listen(connection);
connection.listen();