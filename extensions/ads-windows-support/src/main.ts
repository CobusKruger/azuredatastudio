/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
///
'use strict';

import * as nls from 'vscode-nls';
import * as path from 'path';
import * as shelljs from 'shelljs';
import * as sqlops from 'sqlops';
import * as vscode from 'vscode';
import { IConfig, ServerProvider } from 'service-downloader';
import { Telemetry } from './telemetry';
import * as utils from './utils';

const baseConfig = require('./config.json');
const localize = nls.loadMessageBundle();
let exePath:string;

// Params to pass to SsmsMin.exe, only an action and server are required - the rest are optional based on the
// action used. Exported for use in testing.
export interface LaunchSsmsDialogParams {
    action: string;
    server: string;
    database?: string;
    user?: string;
    password?: string;
    useAad?: boolean;
    urn?: string;
}

export function activate(context: vscode.ExtensionContext): Promise<void> {
    context.subscriptions.push(
        vscode.commands.registerCommand('adminToolExtWin.launchSsmsServerPropertiesDialog', handleLaunchSsmsServerPropertiesDialogCommand));
    // Only supported on Win32 currently, display error message if not that until extensions are able to block install
    // based on conditions
    if(process.platform === 'win32') {
        let config: IConfig = JSON.parse(JSON.stringify(baseConfig));
        config.installDirectory = path.join(context.extensionPath, config.installDirectory);
        config.proxy = utils.getConfiguration('http').get('proxy');
        config.strictSSL = utils.getConfiguration('http').get('proxyStrictSSL') || true;

        const serverdownloader = new ServerProvider(config);
        const installationStart = Date.now();

        return new Promise((resolve, reject) => {
            serverdownloader.getOrDownloadServer().then(e => {
                const installationComplete = Date.now();

                Telemetry.sendTelemetryEvent('startup/ExtensionStarted', {
                    installationTime: String(installationComplete - installationStart),
                    beginningTimestamp: String(installationStart)
                });
                serverdownloader.getServerPath().then(path =>
                    {
                        // Don't register the command if we couldn't find the EXE since it won't be able to do anything
                        if(path) {
                            exePath = path;
                        }
                        resolve();
                    });
            }, e => {
                Telemetry.sendTelemetryEvent('startup/ExtensionInitializationFailed');
                // Just resolve to avoid unhandled promise. We show the error to the user.
                resolve();
            });
        });
    } else {
        vscode.window.showErrorMessage(localize('adminToolExtWin.onlySupportedOnWindows', 'The Admin Tool Extension is only supported on Windows platforms.'));
    }
}

/**
 * Handler for command to launch SSMS Server Properties dialog
 * @param connectionId The connection context from the command
 */
function handleLaunchSsmsServerPropertiesDialogCommand(connectionContext?: any) {
    if(connectionContext.connectionProfile) {
        launchSsmsDialog('sqla:Properties@Microsoft.SqlServer.Management.Smo.Server', connectionContext.connectionProfile, `Server[@Name='${connectionContext.connectionProfile.serverName}']`);
    }
}

/**
 * Launches SsmsMin with parameters from the specified connection
 * @param action The action to launch
 * @param params The params used to construct the command
 * @param urn The URN to pass to SsmsMin
 */
function launchSsmsDialog(action:string, connectionProfile: sqlops.IConnectionProfile, urn?:string) {
    if(!exePath) {
        vscode.window.showErrorMessage(localize('adminToolExtWin.noExeError', 'Unable to find SsmsMin.exe.'));
        return;
    }

    Telemetry.sendTelemetryEvent('LaunchSsmsDialog', { 'action': action});

    let params:LaunchSsmsDialogParams = {
        action:'sqla:Properties@Microsoft.SqlServer.Management.Smo.Server',
        server:connectionProfile.serverName,
        database:connectionProfile.databaseName,
        password:connectionProfile.password,
        user:connectionProfile.userName,
        useAad:connectionProfile.authenticationType === 'AzureMFA',
        urn: urn};
    let args = buildSsmsMinCommandArgs(params);

    var proc = shelljs.exec(
       /*command*/`"${exePath}" ${args}`,
       /*options*/'',
       (code, stdout, stderr) => {
           Telemetry.sendTelemetryEvent('LaunchSsmsDialogResult', {
               'action': params.action,
               'returnCode': code,
               'error': stderr
           });
       });

    // If we're not using AAD the tool prompts for a password on stdin
    if(params.useAad !== true) {
        proc.stdin.end(params.password ? params.password : '');
    }
}

/**
 * Builds the command arguments to pass to SsmsMin.exe
 * @param params The params used to build up the command parameter string
 */
export function buildSsmsMinCommandArgs(params:LaunchSsmsDialogParams): string {
    return `${params.action ? '-a "' + params.action + '"' : ''}\
    ${params.server ? '-S "' + params.server + '"' : ''} \
    ${params.database ? '-D "' + params.database + '"' : ''} \
    ${params.useAad !== true ? '-U "' + params.user + '"' : ''} \
    ${params.useAad === true ? '-G': ''} \
    ${params.urn ? '-u "' + params.urn + '"' : ''}`;
}
