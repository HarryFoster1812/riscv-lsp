import * as path from 'path';
import type { ExtensionContext } from 'vscode';
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    // Point VS Code to the compiled server file
    const serverModule = context.asAbsolutePath(path.join('out', 'server.js'));

    // Configure how the server is launched
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
        }
    };

    // Control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for RISC-V documents specifically
        documentSelector: [{ scheme: 'file', language: 'riscv' }]
    };

    // Create and start the LSP client
    client = new LanguageClient(
        'riscvLsp',
        'RISC-V Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client (this also launches the server)
    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}