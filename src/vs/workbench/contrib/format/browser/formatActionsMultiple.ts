/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, registerEditorAction, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { DocumentRangeFormattingEditProviderRegistry } from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IQuickInputService, IQuickPickItem, IQuickInputButton } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { formatDocumentRangeWithProvider, formatDocumentWithProvider, getRealAndSyntheticDocumentFormattersOrdered } from 'vs/editor/contrib/format/format';
import { Range } from 'vs/editor/common/core/range';
import { showExtensionQuery } from 'vs/workbench/contrib/format/browser/showExtensionQuery';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';

interface IIndexedPick extends IQuickPickItem {
	index: number;
}

const openExtensionAction: IQuickInputButton = {
	tooltip: nls.localize('show.ext', "Show extension..."),
	iconClass: 'format-show-extension'
};

function logFormatterTelemetry<T extends { extensionId?: ExtensionIdentifier }>(telemetryService: ITelemetryService, mode: 'document' | 'range', options: T[], pick?: T) {

	function extKey(obj: T): string {
		return obj.extensionId ? ExtensionIdentifier.toKey(obj.extensionId) : 'unknown';
	}
	/*
	 * __GDPR__
		"formatterpick" : {
			"mode" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
			"extensions" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
			"pick" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		}
	 */
	telemetryService.publicLog('formatterpick', {
		mode,
		extensions: options.map(extKey),
		pick: pick ? extKey(pick) : 'none'
	});
}

registerEditorAction(class FormatDocumentMultipleAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.formatDocument.multiple',
			label: nls.localize('formatDocument.label.multiple', "Format Document With..."),
			alias: 'Format Document...',
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasMultipleDocumentFormattingProvider),
			menuOpts: {
				group: '1_modification',
				order: 1.3
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}
		const instaService = accessor.get(IInstantiationService);
		const quickPickService = accessor.get(IQuickInputService);
		const viewletService = accessor.get(IViewletService);
		const telemetryService = accessor.get(ITelemetryService);
		const model = editor.getModel();

		const provider = getRealAndSyntheticDocumentFormattersOrdered(model);
		const picks = provider.map((provider, index) => {
			return <IIndexedPick>{
				index,
				label: provider.displayName || '',
				buttons: [openExtensionAction]
			};
		});

		const pick = await quickPickService.pick(picks, {
			placeHolder: nls.localize('format.placeHolder', "Select a formatter"),
			onDidTriggerItemButton: (e) => {
				const { extensionId } = provider[e.item.index];
				return showExtensionQuery(viewletService, `@id:${extensionId!.value}`);
			}
		});
		if (pick) {
			await instaService.invokeFunction(formatDocumentWithProvider, provider[pick.index], editor, CancellationToken.None);
		}

		logFormatterTelemetry(telemetryService, 'document', provider, pick && provider[pick.index]);
	}
});

registerEditorAction(class FormatSelectionMultipleAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.formatSelection.multiple',
			label: nls.localize('formatSelection.label.multiple', "Format Selection With..."),
			alias: 'Format Code...',
			precondition: ContextKeyExpr.and(ContextKeyExpr.and(EditorContextKeys.writable), EditorContextKeys.hasMultipleDocumentSelectionFormattingProvider),
			menuOpts: {
				when: ContextKeyExpr.and(EditorContextKeys.hasNonEmptySelection),
				group: '1_modification',
				order: 1.31
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}
		const instaService = accessor.get(IInstantiationService);
		const quickPickService = accessor.get(IQuickInputService);
		const viewletService = accessor.get(IViewletService);
		const telemetryService = accessor.get(ITelemetryService);
		const model = editor.getModel();

		let range: Range = editor.getSelection();
		if (range.isEmpty()) {
			range = new Range(range.startLineNumber, 1, range.startLineNumber, model.getLineMaxColumn(range.startLineNumber));
		}

		const provider = DocumentRangeFormattingEditProviderRegistry.ordered(model);
		const picks = provider.map((provider, index) => {
			return <IIndexedPick>{
				index,
				label: provider.displayName || '',
				buttons: [openExtensionAction]
			};
		});

		const pick = await quickPickService.pick(picks, {
			placeHolder: nls.localize('format.placeHolder', "Select a formatter"),
			onDidTriggerItemButton: (e) => {
				const { extensionId } = provider[e.item.index];
				return showExtensionQuery(viewletService, `@id:${extensionId!.value}`);
			}
		});
		if (pick) {
			await instaService.invokeFunction(formatDocumentRangeWithProvider, provider[pick.index], editor, range, CancellationToken.None);
		}

		logFormatterTelemetry(telemetryService, 'range', provider, pick && provider[pick.index]);
	}
});
