/**
 * @license Copyright (c) 2003-2020, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module anchor/autoanchor
 */

import { Plugin } from 'ckeditor5/src/core';
import { TextWatcher } from 'ckeditor5/src/typing';
import { getLastTextLine } from 'ckeditor5/src/typing';
import { addAnchorProtocolIfApplicable } from './utils';

const MIN_LINK_LENGTH_WITH_SPACE_AT_END = 4; // Ie: "t.co " (length 5).

const URL_REG_EXP = new RegExp(
	// Group 1: Line start or after a space.
	'(^|\\s)' +
	// Group 2: Detected anchor (begin with #, follows HTML5 restrictions on
  // allowed values).
	'(#\\S+)$'
);

const URL_GROUP_IN_MATCH = 2;

/**
 * The autoanchor plugin.
 *
 * @extends module:core/plugin~Plugin
 */
export default class AutoAnchor extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'AutoAnchor';
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;
		const selection = editor.model.document.selection;

		selection.on( 'change:range', () => {
			// Disable plugin when selection is inside a code block.
			this.isEnabled = !selection.anchor.parent.is( 'element', 'codeBlock' );
		} );

		this._enableTypingHandling();
	}

	/**
	 * @inheritDoc
	 */
	afterInit() {
		this._enableEnterHandling();
		this._enableShiftEnterHandling();
	}

	/**
	 * Enables autoanchoring on typing.
	 *
	 * @private
	 */
	_enableTypingHandling() {
		const editor = this.editor;

		const watcher = new TextWatcher( editor.model, text => {
			// 1. Detect <kbd>Space</kbd> after a text with a potential anchor.
			if ( !isSingleSpaceAtTheEnd( text ) ) {
				return;
			}

			// 2. Check text before last typed <kbd>Space</kbd>.
			const url = getUrlAtTextEnd( text.substr( 0, text.length - 1 ) );

			if ( url ) {
				return { url };
			}
		} );

		watcher.on( 'matched:data', ( evt, data ) => {
			const { batch, range, url } = data;

			if ( !batch.isTyping ) {
				return;
			}

			const anchorEnd = range.end.getShiftedBy( -1 ); // Executed after a space character.
			const anchorStart = anchorEnd.getShiftedBy( -url.length );

			const anchorRange = editor.model.createRange( anchorStart, anchorEnd );

			this._applyAutoAnchor( url, anchorRange );
		} );

		watcher.bind( 'isEnabled' ).to( this );
	}

	/**
	 * Enables autoanchoring on the <kbd>Enter</kbd> key.
	 *
	 * @private
	 */
	_enableEnterHandling() {
		const editor = this.editor;
		const model = editor.model;
		const enterCommand = editor.commands.get( 'enter' );

		if ( !enterCommand ) {
			return;
		}

		enterCommand.on( 'execute', () => {
			const position = model.document.selection.getFirstPosition();

			if ( !position.parent.previousSibling ) {
				return;
			}

			const rangeToCheck = model.createRangeIn( position.parent.previousSibling );

			this._checkAndApplyAutoAnchorOnRange( rangeToCheck );
		} );
	}

	/**
	 * Enables autoanchoring on the <kbd>Shift</kbd>+<kbd>Enter</kbd> keyboard shortcut.
	 *
	 * @private
	 */
	_enableShiftEnterHandling() {
		const editor = this.editor;
		const model = editor.model;

		const shiftEnterCommand = editor.commands.get( 'shiftEnter' );

		if ( !shiftEnterCommand ) {
			return;
		}

		shiftEnterCommand.on( 'execute', () => {
			const position = model.document.selection.getFirstPosition();

			const rangeToCheck = model.createRange(
				model.createPositionAt( position.parent, 0 ),
				position.getShiftedBy( -1 )
			);

			this._checkAndApplyAutoAnchorOnRange( rangeToCheck );
		} );
	}

	/**
	 * Checks if the passed range contains a anchorable text.
	 *
	 * @param {module:engine/model/range~Range} rangeToCheck
	 * @private
	 */
	_checkAndApplyAutoAnchorOnRange( rangeToCheck ) {
		const model = this.editor.model;
		const { text, range } = getLastTextLine( rangeToCheck, model );

		const url = getUrlAtTextEnd( text );

		if ( url ) {
			const anchorRange = model.createRange(
				range.end.getShiftedBy( -url.length ),
				range.end
			);

			this._applyAutoAnchor( url, anchorRange );
		}
	}

	/**
	 * Applies a anchor on a given range.
	 *
	 * @param {String} url The URL to anchor.
	 * @param {module:engine/model/range~Range} range The text range to apply the anchor attribute to.
	 * @private
	 */
	_applyAutoAnchor( anchor, range ) {
		const model = this.editor.model;

		if ( !this.isEnabled || !isAnchorAllowedOnRange( range, model ) ) {
			return;
		}

		// Enqueue change to make undo step.
		model.enqueueChange( writer => {
			const defaultProtocol = this.editor.config.get( 'anchor.defaultProtocol' );
			const parsedUrl = addAnchorProtocolIfApplicable( anchor, defaultProtocol );
      // Create a link to an anchor with the parsed value.
			writer.setAttribute( 'linkHref', parsedUrl, range );
		} );
	}
}

// Check if text should be evaluated by the plugin in order to reduce number of RegExp checks on whole text.
function isSingleSpaceAtTheEnd( text ) {
	return text.length > MIN_LINK_LENGTH_WITH_SPACE_AT_END && text[ text.length - 1 ] === ' ' && text[ text.length - 2 ] !== ' ';
}

function getUrlAtTextEnd( text ) {
	const match = URL_REG_EXP.exec( text );

	return match ? match[ URL_GROUP_IN_MATCH ] : null;
}

function isAnchorAllowedOnRange( range, model ) {
	return model.schema.checkAttributeInSelection( model.createSelection( range ), 'anchorId' );
}
