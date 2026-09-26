// eslint-disable-next-line no-redeclare
var H5PEditor = H5PEditor || {};

/**
 * Interactive Video editor widget module
 * TODO: Rewrite to use H5P.DragQuestion for previewing?

 * @param {jQuery} $
 */
H5PEditor.widgets.dragQuestion = H5PEditor.DragQuestion = (function ($, DragNBar) {
  /**
   * Must be changed if the semantics for the elements changes.
   * @πvate
   * @type {string}
   */
  var clipboardKey = 'H5PEditor.DragQuestion';

  /**
   * Editor-only class used to distinguish secondary selections from the
   * DragNBar primary selection.
   *
   * @type {string}
   */
  var secondarySelectionClass = 'papijo-secondary-selected';

  /**
   * Initialize interactive video editor.
   *
   * @param {Object} parent
   * @param {Object} field
   * @param {Object} params
   * @param {function} setValue
   */
  function C(parent, field, params, setValue) {
    var that = this;

    // Secondary selections are transient editor state and are never saved.
    this.secondarySelections = [];
    this.alignControls = [];

    this.fakeDropzoneLibrary = 'H5P.DragQuestionDropzone 0.1';

    this.parent = parent;
    // Set params
    this.params = $.extend({
      elements: [],
      dropZones: []
    }, params);
    setValue(field, this.params);

    // Get updates for fields
    H5PEditor.followField(parent, 'settings/background', (params) => {
      this.setBackground(params);
    });
    H5PEditor.followField(parent, 'settings/size', (params) => {
      this.setSize(params);
    });

    // Are we creating a new D&D content or editing a content (isSetBehaviour is true);
    var isSetBehaviour = parent.parent.params.behaviour;

    // Need the override background opacity for draggables
    this.backgroundOpacity = (isSetBehaviour === undefined) ? undefined : parent.parent.params.behaviour.backgroundOpacity;

    // Need the override background opacity for dropZones
    this.backgroundOpacityDropZones = (isSetBehaviour === undefined) ? undefined : parent.parent.params.behaviour.backgroundOpacityDropZones;
    
    // Update opacity and handles for all dropzones/draggables when global background opacity and handles are changed
    parent.ready(() => {
      const backgroundOpacityInput = H5PEditor.findField('../behaviour/backgroundOpacity', parent).$item.find('input');
      const dragHandleCheckbox = H5PEditor.findField('behaviour/dragHandleVisibility', parent.parent).$item.find('input');

      // Listen for changes
      backgroundOpacityInput.on('change', () => {
        this.setBackgroundOpacity(backgroundOpacityInput.val().trim());
      });

      dragHandleCheckbox.on('change', () => {
        this.setDragHandleVisibility(dragHandleCheckbox.get(0).checked);
      });

      // Initialize values
      this.setDragHandleVisibility(dragHandleCheckbox.get(0).checked);
      this.setBackgroundOpacity(backgroundOpacityInput.val().trim());
    });

    // Get options from semantics, clone since we'll be changing values.
    this.elementFields = H5P.cloneObject(field.fields[0].field.fields, true);
    this.dropZoneFields = H5P.cloneObject(field.fields[1].field.fields, true);
    this.elementLibraryOptions = this.elementFields[0].options;
    if (typeof this.elementLibraryOptions[0] === 'object') {
      this.elementLibraryOptions = this.elementLibraryOptions.map(function (option) {
        return option.name;
      });
    }

    this.elementDropZoneFieldWeight = 5;
    this.elementFields[this.elementDropZoneFieldWeight].options = [];
    this.dropZoneElementFieldWeight = 6;
    this.elementOptions = [];

    this.parent = parent;
    this.field = field;

    this.passReadies = true;
    parent.ready(function () {
      that.passReadies = false;
    });

    H5P.$window.on('resize', function () {
      if (that.size !== undefined && that.size.width !== undefined) {
        that.resize();
      }
    });

    // Update paste button
    H5P.externalDispatcher.on('datainclipboard', function (event) {
      if (!that.libraries) {
        return;
      }
      var canPaste = !event.data.reset;
      if (canPaste) {
        // Check if content type is supported here
        canPaste = that.canPaste(H5P.getClipboard());
      }
      that.dnb.setCanPaste(canPaste);
    });
  }

  /**
   * Append field to wrapper.
   *
   * @param {jQuery} $wrapper
   * @returns {undefined}
   */
  C.prototype.appendTo = function ($wrapper) {
    var that = this;

    this.$item = $(this.createHtml()).appendTo($wrapper);
    this.$editor = this.$item.children('.h5peditor-dragquestion');
    this.$dnbWrapper = this.$item.children('.h5peditor-dragnbar');
    this.$dialog = this.$item.children('.h5peditor-fluid-dialog');
    this.$dialogInner = this.$dialog.children('.h5peditor-fd-inner');
    this.$errors = this.$item.children('.h5p-errors');

    this.$editor.attr('tabindex', -1);

    // Handle click events for dialog buttons.
    this.$dialog.find('.h5peditor-done').click(function () {
      if (that.doneCallback() !== false) {
        that.hideDialog();
      }
      return false;
    }).end().find('.h5peditor-remove').click(function () {
      that.showConfirmationDialog({
        headerText: C.t('deleteTaskTitle'),
        dialogText: C.t('confirmRemoval'),
        cancelText: C.t('cancel'),
        confirmText: C.t('confirm'),
      }, handleFormDialogActions);
    });

    /**
     * Callback confirm/cancel action
     * @param {boolean} [confirmFlag] Which button is clicked
     */
    const handleFormDialogActions = function (confirmFlag) {
      if (!confirmFlag) {
        return false;
      }
      that.removeCallback();
      that.hideDialog();
    };
  };

  /**
   * Check if the clipboard can be pasted into DnD.
   *
   * @param {Object} [clipboard] Clipboard data.
   * @return {boolean} True, if clipboard can be pasted.
   */
  C.prototype.canPaste = function (clipboard) {
    if (clipboard) {
      if (clipboard.from === clipboardKey &&
          (!clipboard.generic || this.supported(clipboard.generic.library))) {
        // Content comes from the same version of DQ
        // Non generic part = must be content like gotoslide or similar
        return true;
      }
      else if (clipboard.generic && this.supported(clipboard.generic.library)) {
        // Supported library from another content type
        return true;
      }
    }

    return false;
  };

  /**
   * Check if library is supported by Drag Question
   *
   * @private
   * @param {string} lib uber name
   * @returns {boolean}
   */
  C.prototype.supported = function (lib) {
    for (var i = 0; i < this.libraries.length; i++) {
      if (this.libraries[i].restricted !== true && this.libraries[i].uberName === lib) {
        return true; // Library is supported and allowed
      }
    }

    return false;
  };

  /**
   * Create HTML for the field.
   *
   * @returns {String}
   */
  C.prototype.createHtml = function () {
    var html = '';
    if (this.field.label !== 0) {
      html += '<span class="h5peditor-label">' + this.field.label + '</span>';
    }

    html += '<div class="h5peditor-dragnbar"></div>' +
      '<div class="h5peditor-dragquestion h5p-theme">' + C.t('noTaskSize') + '</div>' +
      '<div class="h5peditor-fluid-dialog">' +
      '  <div class="h5peditor-fd-inner"></div>' +
      '  <div class="h5peditor-fd-buttons">' +
      '    <a href="#" class="h5peditor-fd-button h5peditor-done">' + C.t('done') + '</a>' +
      '    <a href="#" class="h5peditor-fd-button h5peditor-remove">' + C.t('remove') + '</a>' +
      '  </div>' +
      '</div>';

    if (this.field.description !== undefined) {
      html += '<div class="h5peditor-field-description">' + this.field.description + '</div>';
    }

    // removes the description field, so it's not re-rendered on top
    var field = this.removeAttribute(this.field, 'description');

    return H5PEditor.createFieldMarkup(field, html);
  };

  /**
   * Clones an object, and removes an attribute
   *
   * @param {object} obj
   * @param {string} attributeName
   *
   * @return {object}
   */
  C.prototype.removeAttribute = function (obj, attributeName) {
    var result = H5P.cloneObject(obj);
    result[attributeName] = undefined;
    return result;
  };

  /**
   * Set the global background opacity and update all draggables/dropzones.
   * @param {string} opacity
   * @returns {undefined}
   */
  C.prototype.setBackgroundOpacity = function (opacity) {
    this.backgroundOpacity = opacity;
    this.backgroundOpacity = (this.backgroundOpacity === '') ? undefined : this.backgroundOpacity;
    this.updateDraggableOpacity();
    this.updateAllElementsOpacity(this.elements, this.params.elements, 'element');
  };

  /**
   * Set current background.
   *
   * @param {Object} params
   * @returns {undefined}
   */
  C.prototype.setBackground = function (params) {
    var path = params === undefined ? '' : params.path;
    if (path !== '') {
      // Add correct base path
      path = 'url("' + H5P.getPath(path, H5PEditor.contentId) + '")';
    }

    this.$editor.css({
      backgroundImage: path
    });
  };

  /**
   * Set current dimensions.
   *
   * @param {Object} params
   * @returns {undefined}
   */
  C.prototype.setSize = function (params) {
    this.size = params;
  };

  /**
   * Set handles for draggables.
   * @param {boolean} value if the drag handle should be visible or not
   * @returns {undefined}
   */
  C.prototype.setDragHandleVisibility = function (value) {
    this.showDragHandles = value;
    this.elements?.forEach((element) => {
      element.draggable.setDragHandleVisibility(value);
    });
  };

  /**
   * Apply new size to task editor once visible.
   *
   * @returns {undefined}
   */
  C.prototype.setActive = function () {
    var that = this;
    if (this.size === undefined || this.size.width === undefined) {
      return;
    }

    if (this.dnb === undefined) {
      this.$editor.html('<div class="h5p-throbber">' + H5PEditor.t('core', 'loading') + '</div>')
        .addClass('h5p-ready');
      H5PEditor.LibraryListCache.getLibraries(this.elementLibraryOptions, function (libraries) {
        that.libraries = libraries;

        // Add fake library for copy&paste (Dropzones are no libraries)
        libraries.push({
          uberName: that.fakeDropzoneLibrary,
          name: that.fakeDropzoneLibrary.split(' ')[0],
          title: that.fakeDropzoneLibrary.split(' ')[0].split('.')[1],
          majorVersion: that.fakeDropzoneLibrary.split(' ')[1].split('.')[0],
          minorVersion: that.fakeDropzoneLibrary.split(' ')[1].split('.')[1],
          restricted: false,
          runnable: 0
        });

        // Prevents duplicate loading
        if (this.dnb === undefined) {
          that.activateEditor(libraries);
        }
      });
    }

    this.resize();
  };

  /**
   * Adapt the editor when the window changes size.
   */
  C.prototype.resize = function () {
    if (!this.$editor.is(':visible')) {
      return;
    }
    if (this.fontSize === undefined) {
      // Get editor default font size.
      this.fontSize = parseInt(this.$editor.css('fontSize'));
    }

    var maxWidth = this.$item.width();
    var editorCss;
    if (this.size.width < maxWidth) {
      editorCss = {
        width: this.size.width,
        height: this.size.height,
        fontSize: this.fontSize
      };
      this.$dnbWrapper.css({
        width: this.size.width
      });
    }
    else {
      editorCss = {
        width: '100%',
        height: maxWidth * (this.size.height / this.size.width),
        fontSize: this.fontSize * (maxWidth / this.size.width)
      };
      this.$dnbWrapper.css({
        width: '100%'
      });
    }

    this.$editor.css(editorCss);
    if (this.dnb !== undefined) {
      this.dnb.dnr.setContainerEm(editorCss.fontSize);
    }

    this.pToEm = (parseFloat(window.getComputedStyle(this.$editor[0]).width) / this.fontSize) / 100;
  };

  /**
   * Activate DragNBar and add elements.
   *
   * @returns {undefined}
   */
  C.prototype.activateEditor = function (libraries) {
    var that = this;
    this.removeMultiSelectionHandlers();
    this.$editor.html('').addClass('h5p-ready');
    this.alignControls = [];

    // Ignore fake libraries
    const buttonLibraries = libraries.filter(function (library) {
      return (library.uberName !== that.fakeDropzoneLibrary);
    });

    // Create new bar
    this.dnb = new DragNBar(this.getButtons(buttonLibraries), this.$editor, this.$item, {libraries: libraries});
    that.dnb.dnr.snap = 10;
    this.initializeMultiSelection();

    // Add event handling
    this.dnb.stopMovingCallback = function (x, y) {
      // Update params when the element is dropped.
      var id = that.dnb.dnd.$element.data('id');
      var params = that.dnb.dnd.$element.hasClass('h5p-dq-dz') ? that.params.dropZones[id] : that.params.elements[id];
      params.x = x;
      params.y = y;
    };
    this.dnb.dnd.releaseCallback = function () {
      // Edit element when it is dropped.
      if (that.dnb.newElement) {
        setTimeout(function () {
          that.dnb.dnd.$element.dblclick();
          that.dnb.blurAll();
        }, 1);
      }
    };
    this.dnb.attach(this.$dnbWrapper);

    // Set paste button
    this.dnb.setCanPaste(this.canPaste(H5P.getClipboard()));

    this.dnb.on('paste', function (event) {
      var pasted = event.data;
      var $element;

      if (!pasted.generic || !that.supported(pasted.generic.library)) {
        return that.showConfirmationDialog({
          headerText: H5PEditor.t('core', 'pasteError'),
          dialogText: H5PEditor.t('H5P.DragNBar', 'unableToPaste'),
          cancelText: ' ',
          confirmText: C.t('ok')
        });
      }

      if (pasted.from === clipboardKey) {
        // Pasted content comes from the same version of DQ
        var isDropZone = pasted.generic.library === that.fakeDropzoneLibrary;

        that.center(pasted.specific);

        if (isDropZone) {
          that.params.dropZones.push(pasted.specific);
          $element = that.insertDropZone(that.params.dropZones.length - 1);
        }
        else {
          that.params.elements.push(pasted.specific);
          $element = that.insertElement(that.params.elements.length - 1);
        }

        setTimeout(function () {
          that.dnb.focus($element);
        });

      }
      else {
        // Supported library from another content type
        var id = C.getLibraryID(pasted.generic.library);
        var elementParams = C.getDefaultElementParams(id);
        elementParams.type = pasted.generic;
        elementParams.width = (pasted.width || elementParams.width / that.pToEm) * that.pToEm;
        elementParams.height = (pasted.height || elementParams.height / that.pToEm) * that.pToEm;

        that.center(elementParams);
        that.params.elements.push(elementParams);
        $element = that.insertElement(that.params.elements.length - 1);
        setTimeout(function () {
          that.dnb.focus($element);
        });
      }
    });

    /**
     * Update params on end of resize
     * Dimensions contains a data object where each dimensions is optional.
     */
    this.dnb.dnr.on('stoppedResizing', function (dimensions) {
      var id = that.dnb.$element.data('id');
      var params = that.dnb.$element.hasClass('h5p-dq-dz') ? that.params.dropZones[id] : that.params.elements[id];
      var containerStyle = window.getComputedStyle(that.$editor[0]);

      // Set dimensions if they were passed in
      if (dimensions.data.left !== undefined) {
        params.x = dimensions.data.left / (parseFloat(containerStyle.width) / 100);
      }
      if (dimensions.data.top !== undefined) {
        params.y = dimensions.data.top / (parseFloat(containerStyle.height) / 100);
      }
      if (dimensions.data.width !== undefined) {
        params.width = dimensions.data.width;
      }
      if (dimensions.data.height !== undefined) {
        params.height = dimensions.data.height;
      }
    });

    // Add Elements
    this.elements = [];
    for (var i = 0; i < this.params.elements.length; i++) {
      this.insertElement(i);
    }

    // Add Drop Zones
    this.dropZones = [];
    for (var j = 0; j < this.params.dropZones.length; j++) {
      this.insertDropZone(j);
    }

    this.resize();
  };

  /**
   * Set up editor-local multi-selection handling.
   *
   * Capture phase is required here: DragNBar registers mousedown directly on
   * each element and would otherwise focus and start dragging it first.
   */
  C.prototype.initializeMultiSelection = function () {
    var that = this;
    var originalFocus = this.dnb.focus.bind(this.dnb);
    var originalBlurAll = this.dnb.blurAll.bind(this.dnb);

    this.secondarySelections = [];
    this.multiSelectionMouseDownElement = null;
    this.multiSelectionMouseDownHandler = this.handleMultiSelectionMouseDown.bind(this);
    this.multiSelectionClickHandler = this.handleMultiSelectionClick.bind(this);

    this.$editor[0].addEventListener('mousedown', this.multiSelectionMouseDownHandler, true);
    this.$editor[0].addEventListener('click', this.multiSelectionClickHandler, true);

    // Keep secondary state in sync when DragNBar changes or clears the primary
    // through mouse, keyboard, or an existing editor action.
    this.dnb.focus = function ($element) {
      if (!that.isPrimarySelection($element[0])) {
        that.clearMultiSelection();
      }
      var result = originalFocus($element);
      that.updateAlignUI();
      return result;
    };
    this.dnb.blurAll = function () {
      that.clearMultiSelection();
      var result = originalBlurAll();
      that.updateAlignUI();
      return result;
    };
  };

  /**
   * Remove DOM handlers used for multi-selection.
   */
  C.prototype.removeMultiSelectionHandlers = function () {
    if (!this.$editor || !this.$editor[0]) {
      return;
    }

    if (this.multiSelectionMouseDownHandler) {
      this.$editor[0].removeEventListener('mousedown', this.multiSelectionMouseDownHandler, true);
      delete this.multiSelectionMouseDownHandler;
    }
    if (this.multiSelectionClickHandler) {
      this.$editor[0].removeEventListener('click', this.multiSelectionClickHandler, true);
      delete this.multiSelectionClickHandler;
    }
  };

  /**
   * Find the DragNBar element containing an event target.
   *
   * @param {HTMLElement} target Event target.
   * @returns {HTMLElement|null} Selectable element.
   */
  C.prototype.getSelectableElement = function (target) {
    var editor = this.$editor[0];
    var element = target;

    while (element && element !== editor) {
      if (element.classList && element.classList.contains('h5p-dragnbar-element')) {
        return element;
      }
      element = element.parentNode;
    }

    return null;
  };

  /**
   * Check whether an element is the DragNBar primary selection.
   *
   * @param {HTMLElement} element Element to check.
   * @returns {boolean} Whether the element is primary.
   */
  C.prototype.isPrimarySelection = function (element) {
    if (!this.dnb || !this.dnb.focusedElement) {
      return false;
    }

    return this.dnb.focusedElement.getElement()[0] === element;
  };

  /**
   * Check whether an element is a secondary selection.
   *
   * @param {HTMLElement} element Element to check.
   * @returns {boolean} Whether the element is secondary.
   */
  C.prototype.isSecondarySelected = function (element) {
    return this.secondarySelections.indexOf(element) !== -1;
  };

  /**
   * Add an element to the secondary selection.
   *
   * @param {HTMLElement} element Element to add.
   */
  C.prototype.addSecondarySelection = function (element) {
    if (this.isPrimarySelection(element) || this.isSecondarySelected(element)) {
      return;
    }

    this.secondarySelections.push(element);
    $(element).addClass(secondarySelectionClass);
    this.updateAlignUI();
  };

  /**
   * Remove an element from the secondary selection.
   *
   * @param {HTMLElement} element Element to remove.
   */
  C.prototype.removeSecondarySelection = function (element) {
    var index = this.secondarySelections.indexOf(element);
    if (index === -1) {
      return;
    }

    this.secondarySelections.splice(index, 1);
    $(element).removeClass(secondarySelectionClass);
    this.updateAlignUI();
  };

  /**
   * Toggle an element in the secondary selection.
   *
   * @param {HTMLElement} element Element to toggle.
   */
  C.prototype.toggleSecondarySelection = function (element) {
    if (this.isSecondarySelected(element)) {
      this.removeSecondarySelection(element);
    }
    else {
      this.addSecondarySelection(element);
    }
  };

  /**
   * Clear all secondary selections.
   */
  C.prototype.clearMultiSelection = function () {
    this.secondarySelections.forEach(function (element) {
      $(element).removeClass(secondarySelectionClass);
    });
    this.secondarySelections = [];
    this.updateAlignUI();
  };

  /**
   * Get the alignment actions exposed by the PapiJo-owned panel.
   *
   * @returns {Object[]} Alignment action descriptors.
   */
  C.prototype.getAlignmentActions = function () {
    return [
      {mode: 'left', label: C.t('alignLeft'), symbol: '\u2190'},
      {mode: 'center', label: C.t('alignCenter'), symbol: '\u2194'},
      {mode: 'right', label: C.t('alignRight'), symbol: '\u2192'},
      {mode: 'top', label: C.t('alignTop'), symbol: '\u2191'},
      {mode: 'middle', label: C.t('alignMiddle'), symbol: '\u2195'},
      {mode: 'bottom', label: C.t('alignBottom'), symbol: '\u2193'}
    ];
  };

  /**
   * Get the size actions exposed by the PapiJo-owned panel.
   *
   * @returns {Object[]} Size action descriptors.
   */
  C.prototype.getSizeActions = function () {
    return [
      {mode: 'width', label: C.t('sameWidth'), symbol: 'W'},
      {mode: 'height', label: C.t('sameHeight'), symbol: 'H'},
      {mode: 'size', label: C.t('sameSize'), symbol: 'W\u00d7H'}
    ];
  };

  /**
   * Get the distribution actions exposed by the PapiJo-owned panel.
   *
   * @returns {Object[]} Distribution action descriptors.
   */
  C.prototype.getDistributionActions = function () {
    return [
      {mode: 'horizontal', label: C.t('distributeHorizontally'), symbol: 'H\u2194'},
      {mode: 'vertical', label: C.t('distributeVertically'), symbol: 'V\u2195'}
    ];
  };

  /**
   * Add a conditional multi-selection trigger and its PapiJo-owned panel.
   * DragNBar's public button extension is used for the trigger only.
   *
   * @param {Object} dnbElement DragNBar element.
   */
  C.prototype.addAlignControl = function (dnbElement) {
    var that = this;
    var contextMenu = dnbElement.contextMenu;

    dnbElement.addButton('PapiJoAlign', C.t('arrange'));

    var $trigger = contextMenu.$contextMenu.find('.papijoalign');
    var $panel = $('<div class="papijo-align-panel papijo-multi-selection-panel"></div>')
      .attr('aria-label', C.t('arrange'))
      .hide()
      .appendTo(contextMenu.$contextMenu);
    var $alignGroup = $('<div class="papijo-multi-selection-group" role="group"></div>')
      .attr('aria-label', C.t('align'))
      .appendTo($panel);
    var $sizeGroup = $('<div class="papijo-multi-selection-group" role="group"></div>')
      .attr('aria-label', C.t('resize'))
      .appendTo($panel);
    var $distributionGroup = $('<div class="papijo-multi-selection-group" role="group"></div>')
      .attr('aria-label', C.t('distribute'))
      .appendTo($panel);
    var control = {
      dnbElement: dnbElement,
      $trigger: $trigger,
      $panel: $panel
    };

    $trigger
      .attr('aria-haspopup', 'true')
      .attr('aria-expanded', 'false')
      .hide();

    $('<span class="papijo-multi-selection-heading"></span>')
      .text(C.t('align'))
      .appendTo($alignGroup);
    this.getAlignmentActions().forEach(function (action) {
      $('<button type="button" class="papijo-align-action papijo-multi-selection-action"></button>')
        .attr('data-align-mode', action.mode)
        .attr('aria-label', action.label)
        .attr('title', action.label)
        .text(action.symbol)
        .on('mousedown', function (event) {
          event.preventDefault();
          event.stopPropagation();
        })
        .on('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          that.alignSelection(action.mode);
        })
        .appendTo($alignGroup);
    });

    $('<span class="papijo-multi-selection-heading"></span>')
      .text(C.t('resize'))
      .appendTo($sizeGroup);
    this.getSizeActions().forEach(function (action) {
      $('<button type="button" class="papijo-size-action papijo-multi-selection-action"></button>')
        .attr('data-size-mode', action.mode)
        .attr('aria-label', action.label)
        .attr('title', action.label)
        .text(action.symbol)
        .on('mousedown', function (event) {
          event.preventDefault();
          event.stopPropagation();
        })
        .on('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          that.sizeSelection(action.mode);
        })
        .appendTo($sizeGroup);
    });

    $('<span class="papijo-multi-selection-heading"></span>')
      .text(C.t('distribute'))
      .appendTo($distributionGroup);
    this.getDistributionActions().forEach(function (action) {
      $('<button type="button" class="papijo-distribution-action papijo-multi-selection-action"></button>')
        .attr('data-distribution-mode', action.mode)
        .attr('aria-label', action.label)
        .attr('title', action.label)
        .text(action.symbol)
        .on('mousedown', function (event) {
          event.preventDefault();
          event.stopPropagation();
        })
        .on('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          that.distributeSelection(action.mode);
        })
        .appendTo($distributionGroup);
    });

    contextMenu.on('contextMenuPapiJoAlign', function () {
      that.toggleAlignPanel(control);
    });
    contextMenu.on('contextMenuTransform', function () {
      that.closeAlignPanels();
    });
    this.alignControls.push(control);
    this.updateAlignUI();
  };

  /**
   * Close every multi-selection panel.
   */
  C.prototype.closeAlignPanels = function () {
    (this.alignControls || []).forEach(function (control) {
      control.$panel.hide();
      control.$trigger.attr('aria-expanded', 'false').removeClass('active');
    });
  };

  /**
   * Keep multi-selection controls synchronized with primary and selection.
   */
  C.prototype.updateAlignUI = function () {
    if (!this.alignControls || !this.alignControls.length || !this.$editor) {
      return;
    }

    var primaryDnbElement = this.dnb && this.dnb.focusedElement;
    var selection = primaryDnbElement ? this.getGeometrySelection() : [];
    var isMultiSelection = selection.length > 1;

    this.$editor.toggleClass('papijo-has-multi-selection', isMultiSelection);
    this.alignControls.forEach(function (control) {
      var show = isMultiSelection && control.dnbElement === primaryDnbElement;
      control.$trigger.toggle(show);
      if (!show) {
        control.$panel.hide();
        control.$trigger.attr('aria-expanded', 'false').removeClass('active');
      }
    });
  };

  /**
   * Toggle one multi-selection panel if it belongs to the current primary.
   *
   * @param {Object} control Align control record.
   */
  C.prototype.toggleAlignPanel = function (control) {
    this.updateAlignUI();
    if (!this.dnb || control.dnbElement !== this.dnb.focusedElement ||
        this.getGeometrySelection().length < 2) {
      this.closeAlignPanels();
      return;
    }

    var shouldOpen = !control.$panel.is(':visible');
    this.closeAlignPanels();
    control.$panel.toggle(shouldOpen);
    control.$trigger.attr('aria-expanded', shouldOpen ? 'true' : 'false')
      .toggleClass('active', shouldOpen);
  };

  /**
   * Handle selection on mouse down before DragNBar sees the event.
   *
   * @param {MouseEvent} event Mouse event.
   */
  C.prototype.handleMultiSelectionMouseDown = function (event) {
    var element = this.getSelectableElement(event.target);
    var hasModifier = event.ctrlKey || event.shiftKey;

    this.multiSelectionMouseDownElement = null;

    if (event.button !== 0) {
      return;
    }

    if (!hasModifier) {
      this.clearMultiSelection();
      return;
    }

    if (!element) {
      return;
    }

    // Prevent native focus, DragNBar focus, and DragNBar drag press.
    event.preventDefault();
    event.stopPropagation();
    this.multiSelectionMouseDownElement = element;

    if (!this.isPrimarySelection(element)) {
      this.toggleSecondarySelection(element);
    }
  };

  /**
   * Suppress the click that follows an intercepted modifier mousedown.
   * This also protects the primary if the modifier key is released before
   * mouseup. Synthetic modifier-clicks are handled here as a fallback.
   *
   * @param {MouseEvent} event Mouse event.
   */
  C.prototype.handleMultiSelectionClick = function (event) {
    var element = this.getSelectableElement(event.target);
    var mouseDownElement = this.multiSelectionMouseDownElement;
    this.multiSelectionMouseDownElement = null;

    if (mouseDownElement && mouseDownElement === element) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!(event.ctrlKey || event.shiftKey) || !element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (!this.isPrimarySelection(element)) {
      this.toggleSecondarySelection(element);
    }
  };

  /**
   * Resolve an editor element to its current object and parameters.
   * Numeric IDs are resolved at operation time; DOM nodes remain the
   * selection identity.
   *
   * @param {HTMLElement} element Editor element.
   * @returns {Object|null} Resolved geometry object.
   */
  C.prototype.resolveGeometryObject = function (element) {
    var $element = $(element);
    var isDropZone = $element.hasClass('h5p-dq-dz');
    var objects = isDropZone ? this.dropZones : this.elements;
    var params = isDropZone ? this.params.dropZones : this.params.elements;
    var elementProperty = isDropZone ? '$dropZone' : '$element';
    var id = Number($element.data('id'));

    // Verify the mutable data ID before trusting it, then fall back to the DOM
    // reference if an operation observes the element during reindexing.
    if (id % 1 !== 0 || !objects[id] || objects[id][elementProperty][0] !== element) {
      id = -1;
      for (var i = 0; i < objects.length; i++) {
        if (objects[i][elementProperty][0] === element) {
          id = i;
          break;
        }
      }
    }

    if (id < 0 || !params[id]) {
      return null;
    }

    return {
      element: element,
      $element: $element,
      type: isDropZone ? 'dropZone' : 'draggable',
      id: id,
      params: params[id],
      editorObject: objects[id]
    };
  };

  /**
   * Get the current geometry selection with the DragNBar primary first.
   *
   * @returns {Object[]} Resolved geometry objects.
   */
  C.prototype.getGeometrySelection = function () {
    var selection = [];
    var primary;

    if (this.dnb && this.dnb.focusedElement) {
      primary = this.dnb.focusedElement.getElement()[0];
      var primaryObject = this.resolveGeometryObject(primary);
      if (primaryObject) {
        selection.push(primaryObject);
      }
    }

    this.secondarySelections.forEach(function (element) {
      if (element === primary) {
        return;
      }
      var geometryObject = this.resolveGeometryObject(element);
      if (geometryObject) {
        selection.push(geometryObject);
      }
    }, this);

    return selection;
  };

  /**
   * Get the rendered inner canvas box.
   *
   * @returns {Object} Canvas origin and dimensions in rendered pixels.
   */
  C.prototype.getRenderedCanvasBox = function () {
    var editor = this.$editor[0];
    var rect = editor.getBoundingClientRect();
    var style = window.getComputedStyle(editor);
    var borderLeft = parseFloat(style.borderLeftWidth) || 0;
    var borderRight = parseFloat(style.borderRightWidth) || 0;
    var borderTop = parseFloat(style.borderTopWidth) || 0;
    var borderBottom = parseFloat(style.borderBottomWidth) || 0;

    return {
      left: rect.left + borderLeft,
      top: rect.top + borderTop,
      width: rect.width - borderLeft - borderRight,
      height: rect.height - borderTop - borderBottom
    };
  };

  /**
   * Measure an editor object's rendered outer rectangle relative to the
   * canvas inner edge.
   *
   * @param {Object|HTMLElement} object Resolved geometry object or element.
   * @returns {Object|null} Rendered rectangle.
   */
  C.prototype.measureGeometryObject = function (object) {
    object = object && object.element ? object : this.resolveGeometryObject(object);
    if (!object) {
      return null;
    }

    var canvas = this.getRenderedCanvasBox();
    var rect = object.element.getBoundingClientRect();
    var left = rect.left - canvas.left;
    var top = rect.top - canvas.top;

    return {
      left: left,
      top: top,
      width: rect.width,
      height: rect.height,
      right: left + rect.width,
      bottom: top + rect.height,
      centerX: left + (rect.width / 2),
      centerY: top + (rect.height / 2)
    };
  };

  /**
   * Convert rendered editor-relative pixel coordinates to persisted percent.
   *
   * @param {number} [left] Left coordinate in pixels.
   * @param {number} [top] Top coordinate in pixels.
   * @returns {Object|null} Partial x/y parameter values.
   */
  C.prototype.convertRenderedPositionToPercent = function (left, top) {
    var canvas = this.getRenderedCanvasBox();
    if (canvas.width <= 0 || canvas.height <= 0) {
      return null;
    }

    var position = {};
    if (left !== undefined) {
      position.x = left / (canvas.width / 100);
    }
    if (top !== undefined) {
      position.y = top / (canvas.height / 100);
    }
    return position;
  };

  /**
   * Get the current rendered editor em size.
   *
   * @returns {number} Current em size in pixels.
   */
  C.prototype.getCurrentEditorEm = function () {
    var currentEm = parseFloat(window.getComputedStyle(this.$editor[0]).fontSize);
    if ((!isFinite(currentEm) || currentEm <= 0) && this.dnb && this.dnb.dnr) {
      currentEm = this.dnb.dnr.containerEm;
    }
    return currentEm;
  };

  /**
   * Convert desired rendered outer dimensions to target-specific em values.
   *
   * @param {Object|HTMLElement} object Resolved geometry object or element.
   * @param {number} [width] Desired rendered outer width.
   * @param {number} [height] Desired rendered outer height.
   * @returns {Object|null} Partial width/height parameter values.
   */
  C.prototype.convertRenderedOuterSizeToEm = function (object, width, height) {
    object = object && object.element ? object : this.resolveGeometryObject(object);
    if (!object) {
      return null;
    }

    var currentEm = this.getCurrentEditorEm();
    if (!isFinite(currentEm) || currentEm <= 0) {
      return null;
    }

    var style = window.getComputedStyle(object.element);
    var rendered = object.element.getBoundingClientRect();
    var cssWidth = parseFloat(style.width);
    var cssHeight = parseFloat(style.height);
    var size = {};

    if (width !== undefined) {
      var horizontalExtras = rendered.width - cssWidth;
      var targetWidth = width - horizontalExtras;
      if (!isFinite(targetWidth) || targetWidth <= 0) {
        return null;
      }
      size.width = targetWidth / currentEm;
    }

    if (height !== undefined) {
      var verticalExtras = rendered.height - cssHeight;
      var targetHeight = height - verticalExtras;
      if (!isFinite(targetHeight) || targetHeight <= 0) {
        return null;
      }
      size.height = targetHeight / currentEm;
    }

    return size;
  };

  /**
   * Check whether a rendered rectangle stays inside the current canvas.
   * Existing sub-minimum legacy sizes are accepted here.
   *
   * @param {Object} rect Rendered rectangle.
   * @returns {boolean} Whether the rectangle is within bounds.
   */
  C.prototype.isGeometryRectWithinBounds = function (rect) {
    var canvas = this.getRenderedCanvasBox();
    return isFinite(rect.left) && isFinite(rect.top) &&
      isFinite(rect.width) && isFinite(rect.height) &&
      rect.left >= 0 && rect.top >= 0 &&
      rect.width >= 0 && rect.height >= 0 &&
      rect.left + rect.width <= canvas.width &&
      rect.top + rect.height <= canvas.height;
  };

  /**
   * Validate only dimensions explicitly requested by a new size operation.
   *
   * @param {Object} size Partial rendered outer width/height.
   * @returns {boolean} Whether requested dimensions meet DragNResize minimum.
   */
  C.prototype.isRequestedGeometrySizeValid = function (size) {
    var minimumSize = 24;
    return (size.width === undefined || (isFinite(size.width) && size.width >= minimumSize)) &&
      (size.height === undefined || (isFinite(size.height) && size.height >= minimumSize));
  };

  /**
   * Prepare a position and/or size update without mutating DOM or parameters.
   *
   * @param {Object|HTMLElement} object Resolved geometry object or element.
   * @param {Object} changes Desired rendered left/top/width/height.
   * @returns {Object|null} Prepared geometry update.
   */
  C.prototype.prepareGeometryUpdate = function (object, changes) {
    changes = changes || {};
    object = object && object.element ? object : this.resolveGeometryObject(object);
    var current = this.measureGeometryObject(object);
    if (!object || !current) {
      return null;
    }

    var rect = {
      left: changes.left !== undefined ? changes.left : current.left,
      top: changes.top !== undefined ? changes.top : current.top,
      width: changes.width !== undefined ? changes.width : current.width,
      height: changes.height !== undefined ? changes.height : current.height
    };
    rect.right = rect.left + rect.width;
    rect.bottom = rect.top + rect.height;
    rect.centerX = rect.left + (rect.width / 2);
    rect.centerY = rect.top + (rect.height / 2);

    var position = (changes.left !== undefined || changes.top !== undefined) ?
      this.convertRenderedPositionToPercent(changes.left, changes.top) : {};
    var size = (changes.width !== undefined || changes.height !== undefined) ?
      this.convertRenderedOuterSizeToEm(object, changes.width, changes.height) : {};
    if (!position || !size) {
      return null;
    }

    var params = {};
    var styles = {};
    if (position.x !== undefined) {
      params.x = position.x;
      styles.left = position.x + '%';
    }
    if (position.y !== undefined) {
      params.y = position.y;
      styles.top = position.y + '%';
    }
    if (size.width !== undefined) {
      params.width = size.width;
      styles.width = size.width + 'em';
    }
    if (size.height !== undefined) {
      params.height = size.height;
      styles.height = size.height + 'em';
    }

    return {
      object: object,
      rect: rect,
      requestedSize: {
        width: changes.width,
        height: changes.height
      },
      params: params,
      styles: styles
    };
  };

  /**
   * Validate every update in a prepared geometry plan.
   *
   * @param {Object[]} updates Prepared updates.
   * @returns {boolean} Whether every update is valid.
   */
  C.prototype.validateGeometryPlan = function (updates) {
    if (!Array.isArray(updates)) {
      return false;
    }

    return updates.every(function (update) {
      return update && this.isGeometryRectWithinBounds(update.rect) &&
        this.isRequestedGeometrySizeValid(update.requestedSize);
    }, this);
  };

  /**
   * Atomically apply a fully prepared geometry plan.
   *
   * @param {Object[]} updates Prepared updates.
   * @returns {boolean} Whether the plan was committed.
   */
  C.prototype.applyGeometryPlan = function (updates) {
    if (!this.validateGeometryPlan(updates)) {
      return false;
    }

    updates.forEach(function (update) {
      update.object.$element.css(update.styles);
      Object.keys(update.params).forEach(function (key) {
        update.object.params[key] = update.params[key];
      });
    });
    return true;
  };

  /**
   * Prepare all secondary position updates for one alignment operation.
   * The primary is measured as the reference and is never an update target.
   *
   * @param {string} mode Alignment mode.
   * @returns {Object[]|null} Complete prepared plan, or null when unavailable.
   */
  C.prototype.prepareAlignmentPlan = function (mode) {
    var selection = this.getGeometrySelection();
    if (selection.length < 2) {
      return null;
    }

    var measurements = selection.map(function (object) {
      return this.measureGeometryObject(object);
    }, this);
    if (measurements.some(function (measurement) { return !measurement; })) {
      return null;
    }

    var primary = measurements[0];
    var updates = [];
    for (var i = 1; i < selection.length; i++) {
      var secondary = measurements[i];
      var changes = {};

      if (mode === 'left') {
        changes.left = primary.left;
      }
      else if (mode === 'center') {
        changes.left = primary.centerX - (secondary.width / 2);
      }
      else if (mode === 'right') {
        changes.left = primary.right - secondary.width;
      }
      else if (mode === 'top') {
        changes.top = primary.top;
      }
      else if (mode === 'middle') {
        changes.top = primary.centerY - (secondary.height / 2);
      }
      else if (mode === 'bottom') {
        changes.top = primary.bottom - secondary.height;
      }
      else {
        return null;
      }

      var update = this.prepareGeometryUpdate(selection[i], changes);
      if (!update) {
        return null;
      }
      updates.push(update);
    }

    return updates;
  };

  /**
   * Align every secondary to the fixed primary using one atomic plan.
   *
   * @param {string} mode Alignment mode.
   * @returns {boolean} Whether the complete alignment was applied.
   */
  C.prototype.alignSelection = function (mode) {
    var updates = this.prepareAlignmentPlan(mode);
    return updates ? this.applyGeometryPlan(updates) : false;
  };

  /**
   * Prepare all secondary updates for one same-size operation.
   * Requested outer dimensions are converted for each target's box model.
   *
   * @param {string} mode Size mode: width, height, or size.
   * @returns {Object[]|null} Complete prepared plan, or null when unavailable.
   */
  C.prototype.prepareSizePlan = function (mode) {
    var selection = this.getGeometrySelection();
    if (selection.length < 2 || ['width', 'height', 'size'].indexOf(mode) === -1) {
      return null;
    }

    var primary = this.measureGeometryObject(selection[0]);
    if (!primary) {
      return null;
    }

    var updates = [];
    for (var i = 1; i < selection.length; i++) {
      var changes = {};
      if (mode === 'width' || mode === 'size') {
        changes.width = primary.width;
      }
      if (mode === 'height' || mode === 'size') {
        changes.height = primary.height;
      }

      var update = this.prepareGeometryUpdate(selection[i], changes);
      updates.push(update);
    }

    return updates;
  };

  /**
   * Independently resize each valid secondary to the fixed primary.
   *
   * @param {string} mode Size mode: width, height, or size.
   * @returns {boolean} Whether the complete size operation was applied.
   */
  C.prototype.sizeSelection = function (mode) {
    var updates = this.prepareSizePlan(mode);
    if (!updates) {
      return false;
    }

    var applied = false;
    updates.forEach(function (update) {
      if (update && this.applyGeometryPlan([update])) {
        applied = true;
      }
    }, this);
    return applied;
  };

  /**
   * Prepare one whole-group equal-gap distribution plan.
   *
   * @param {string} mode Distribution mode: horizontal or vertical.
   * @returns {Object[]|null} Complete prepared plan, or null when invalid.
   */
  C.prototype.prepareDistributionPlan = function (mode) {
    var selection = this.getGeometrySelection();
    if (selection.length < 3 || ['horizontal', 'vertical'].indexOf(mode) === -1) {
      return null;
    }

    var entries = selection.map(function (object) {
      return {
        object: object,
        rect: this.measureGeometryObject(object)
      };
    }, this);
    if (entries.some(function (entry) { return !entry.rect; })) {
      return null;
    }

    var start = mode === 'horizontal' ? 'left' : 'top';
    var end = mode === 'horizontal' ? 'right' : 'bottom';
    var size = mode === 'horizontal' ? 'width' : 'height';
    var tolerance = 0.01;
    var minimumStart = Math.min.apply(null, entries.map(function (entry) {
      return entry.rect[start];
    }));
    var maximumEnd = Math.max.apply(null, entries.map(function (entry) {
      return entry.rect[end];
    }));
    var startEndpoints = entries.filter(function (entry) {
      return Math.abs(entry.rect[start] - minimumStart) < tolerance;
    });
    var endEndpoints = entries.filter(function (entry) {
      return Math.abs(entry.rect[end] - maximumEnd) < tolerance;
    });

    if (startEndpoints.length !== 1 || endEndpoints.length !== 1 ||
        startEndpoints[0] === endEndpoints[0]) {
      return null;
    }

    var primary = entries[0];
    var startEndpoint = startEndpoints[0];
    var endEndpoint = endEndpoints[0];
    if (primary !== startEndpoint && primary !== endEndpoint) {
      return null;
    }

    var internal = entries.filter(function (entry) {
      return entry !== startEndpoint && entry !== endEndpoint;
    }).sort(function (a, b) {
      return a.rect[start] - b.rect[start] || a.rect[end] - b.rect[end];
    });
    var ordered = [startEndpoint].concat(internal, [endEndpoint]);
    var totalSize = entries.reduce(function (total, entry) {
      return total + entry.rect[size];
    }, 0);
    var gap = (maximumEnd - minimumStart - totalSize) / (entries.length - 1);
    if (!isFinite(gap) || gap < 0) {
      return null;
    }

    var updates = [];
    var nextPosition = startEndpoint.rect[end] + gap;
    for (var i = 1; i < ordered.length - 1; i++) {
      var changes = {};
      changes[start] = nextPosition;
      var update = this.prepareGeometryUpdate(ordered[i].object, changes);
      if (!update) {
        return null;
      }
      updates.push(update);
      nextPosition += ordered[i].rect[size] + gap;
    }

    return updates;
  };

  /**
   * Atomically distribute internal selected objects between fixed endpoints.
   *
   * @param {string} mode Distribution mode: horizontal or vertical.
   * @returns {boolean} Whether the complete distribution was applied.
   */
  C.prototype.distributeSelection = function (mode) {
    var updates = this.prepareDistributionPlan(mode);
    return updates ? this.applyGeometryPlan(updates) : false;
  };

  /**
   * Help center new elements
   * @param {object} params
   */
  C.prototype.center = function (params) {
    var size = window.getComputedStyle(this.dnb.$container[0]);
    var width = parseFloat(size.width);
    var height = parseFloat(size.height);
    var pos = {
      x: (width - (params.width * this.fontSize)) / 2,
      y: (height - (params.height * this.fontSize)) / 2
    };
    this.dnb.avoidOverlapping(pos, {
      width: params.width * this.fontSize,
      height: params.height * this.fontSize,
    });
    params.x = pos.x / (width / 100);
    params.y = pos.y / (height / 100);
  };

  /**
   * Generate sub forms that's ready to use in the dialog.
   *
   * @param {Object} semantics
   * @param {Object} params
   * @returns {Object} generatedForm
   */
  C.prototype.generateForm = function (semantics, params) {
    var $form = $('<div></div>');
    H5PEditor.processSemanticsChunk(semantics, params, $form, this);

    // Remove library selector and copy button and paste button
    var pos = semantics.map(function (field) {
      return field.type;
    }).indexOf('library');
    if (pos > -1) {
      this.children[pos].hide();
    }

    var $lib = $form.children('.library:first');
    if ($lib.length !== 0) {
      $lib.children('label, select, .h5peditor-field-description').hide().end().children('.libwrap').css('margin-top', '0');
    }

    return {
      $form: $form,
      children: this.children
    };
  };

  /**
   * Generate a list of buttons for DnB.
   *
   * @returns {Array} Buttons
   */
  C.prototype.getButtons = function (libraries) {
    var that = this;
    var id = 'dropzone';
    var buttons = [{
      id: id,
      title: C.t('insertElement', {':type': C.t(id)}),
      createElement: function () {
        that.params.dropZones.push({
          x: 0,
          y: 0,
          width: 5,
          height: 2.5,
          correctElements: []
        });

        return that.insertDropZone(that.params.dropZones.length - 1);
      }
    }];

    for (var i = 0; i < libraries.length; i++) {
      if (libraries[i].restricted !== true) {
        buttons.push(this.getButton(libraries[i]));
      }
    }

    return buttons;
  };

  /**
   * Creates a fresh object with default element parameters.
   * @returns {object}
   */
  C.getDefaultElementParams = function (id) {
    return {
      x: 0,
      y: 0,
      width: 5,
      height: id === 'advancedtext' ? 2.25 : 5,
      dropZones: []
    };
  };

  /**
   * Find generic library identifier without version name.
   *
   * @param {string} library
   * @returns {string}
   */
  C.getLibraryID = function (library) {
    return library.split(' ')[0].split('.')[1].toLowerCase();
  };

  /**
   * Generate a single element button for the DnB.
   *
   * @param {String} library Library name + version
   * @returns {Object} DnB button semantics
   */
  C.prototype.getButton = function (library) {
    var that = this;
    var id = C.getLibraryID(library.uberName);
    return {
      id: id,
      title: library.title,
      createElement: function () {
        var elementParams = C.getDefaultElementParams(id);
        elementParams.type = {
          library: library.uberName,
          params: {}
        };
        that.params.elements.push(elementParams);
        return that.insertElement(that.params.elements.length - 1);
      }
    };
  };

  /**
   * Insert element at given params index.
   *
   * @param {int} index
   * @returns {jQuery} The element's DOM
   */
  C.prototype.insertElement = function (index) {
    var that = this;
    var elementParams = this.params.elements[index];
    var element = this.generateForm(this.elementFields, elementParams);

    var library = this.children[0];
    // Get image aspect ratio
    var libraryChange = function () {
      if (library.children[0].field.type === 'image') {
        library.children[0].changes.push(function (params) {
          if (params === undefined) {
            return;
          }

          if (params.width !== undefined && params.height !== undefined) {
            var editorStyles = window.getComputedStyle(that.$editor[0]);
            var editorWidth = parseFloat(editorStyles.width);
            var editorHeight = parseFloat(editorStyles.height);

            var aspectRatio = params.height / params.width;
            if (editorHeight / editorWidth > aspectRatio) {
              elementParams.height = elementParams.width * aspectRatio;
            }
            else {
              elementParams.width = elementParams.height / aspectRatio;
            }

            element.$element.css({
              width: elementParams.width + 'em',
              height: elementParams.height + 'em'
            });
          }
        });
      }
    };

    if (library.children === undefined) {
      library.changes.push(libraryChange);
    }
    else {
      libraryChange();
    }

    element.$element = $('<div class="h5p-dq-element" style="width:' + elementParams.width + 'em;height:' + elementParams.height + 'em;top:' + elementParams.y + '%;left:' + elementParams.x + '%"></div>')
      .data('id', index)
      .appendTo(this.$editor)
      .dblclick(function () {
        that.editElement(element);
      }).hover(function () {
        C.setElementOpacity(element.$element, that.getElementOpacitySetting(elementParams));
      }, function () {
        // Need this timeout for firefox beeing able to get the css hover rule in place
        setTimeout(function () {
          C.setElementOpacity(element.$element, that.getElementOpacitySetting(elementParams));
        }, 1);
      });

    const noop = () => {};
    element.draggable = H5P.Components.Draggable({
      label: '',
      hasHandle: this.showDragHandles,
      handleRevert: noop,
      handleDragStartEvent: noop,
      handleDragEvent: noop,
      handleDragStopEvent: noop,
    });
    element.draggable.removeAttribute('tabindex');
    element.$innerElement = $(element.draggable).appendTo(element.$element);

    element.draggable.setContentOpacity(Number(this.backgroundOpacity));

    setTimeout(function () {
      var type = (elementParams.type ? elementParams.type.library.split(' ')[0] : null);

      var dnbElement = that.dnb.add(element.$element, DragNBar.clipboardify(clipboardKey, elementParams, 'type'), {
        cornerLock: (type === 'H5P.Image')
      });

      dnbElement.contextMenu.on('contextMenuEdit', function () {
        that.editElement(element);
        that.dnb.blurAll();
      });

      dnbElement.contextMenu.on('contextMenuRemove', that.elementRemove.bind(that, element));
      dnbElement.contextMenu.on('contextMenuBringToFront', that.elementBringToFront.bind(that, element));
      dnbElement.contextMenu.on('contextMenuSendToBack', that.elementSendToBack.bind(that, element));
      that.addAlignControl(dnbElement);
      that.dnb.focus(element.$element);
    }, 0);

    // Update element
    that.updateElement(element, index);

    this.elements[index] = element;
    return element.$element;
  };

  /**
   * Removes an element
   *
   * @param {object} element
   */
  C.prototype.elementRemove = function (element) {
    var that = this;

    /**
     * Callback confirm/cancel action
     * @param {boolean} [confirmFlag] Which button is clicked
     */
    const handleTaskDialogActions = function (confirmFlag) {
      if (!confirmFlag) {
        return false;
      }

      var id = element.$element.data('id');
      var value = id.toString();

      // Remove element form
      H5PEditor.removeChildren(element.children);

      // Remove element
      element.$element.remove();
      that.elements.splice(id, 1);
      that.params.elements.splice(id, 1);

      // Remove from options
      that.elementOptions.splice(id, 1);

      // Update drop zone params
      that.params.dropZones.forEach(function (dropZone) {
        // Update correct elements for drop zone
        for (let i = 0; i < dropZone.correctElements.length; i++) {
          if (dropZone.correctElements[i] === value) {
            dropZone.correctElements.splice(i, 1);
            i--;
          }
          else if (parseInt(dropZone.correctElements[i]) > id) {
            dropZone.correctElements[i] = '' + (parseInt(dropZone.correctElements[i]) - 1);
          }
        }
      });

      that.updateInternalElementIDs(id);
      that.dnb.blurAll();
    };

    // confirm remove
    that.showConfirmationDialog({
      headerText: C.t('deleteTaskTitle'),
      dialogText: C.t('confirmRemoval'),
      cancelText: C.t('cancel'),
      confirmText: C.t('confirm'),
    }, handleTaskDialogActions);
  };

  /**
   * Brings an element to the front
   *
   * @param {object} element
   */
  C.prototype.elementBringToFront = function (element) {
    var that = this;

    // Find element ID
    var id = element.$element.data('id');
    var oldId = id.toString();

    // Update visuals
    element.$element.appendTo(that.$editor);

    // Give new ID
    that.elements.push(that.elements.splice(id, 1)[0]);
    that.params.elements.push(that.params.elements.splice(id, 1)[0]);
    that.elementOptions.push(that.elementOptions.splice(id, 1)[0]);

    var newId = (that.elements.length - 1).toString();
    that.params.dropZones.forEach(function (dropZone) {
      // Update correct elements for drop zone
      for (let i = 0; i < dropZone.correctElements.length; i++) {
        if (dropZone.correctElements[i] === oldId) {
          dropZone.correctElements[i] = newId;
        }
        else if (parseInt(dropZone.correctElements[i]) > id) {
          dropZone.correctElements[i] = (parseInt(dropZone.correctElements[i]) - 1).toString();
        }
      }
    });

    that.updateInternalElementIDs(id);
  };

  /**
   * Sends an element to the back
   *
   * @param {object} element
   */
  C.prototype.elementSendToBack = function (element) {
    var that = this;

    // Find element ID
    var id = element.$element.data('id');
    var oldId = id.toString();

    // Update visuals
    element.$element.prependTo(that.$editor);

    // Give new ID
    that.elements.unshift(that.elements.splice(id, 1)[0]);
    that.params.elements.unshift(that.params.elements.splice(id, 1)[0]);
    that.elementOptions.unshift(that.elementOptions.splice(id, 1)[0]);

    var newId = '0';
    that.params.dropZones.forEach(function (dropZone) {
      // Update correct elements for drop zone
      for (let i = 0; i < dropZone.correctElements.length; i++) {
        if (dropZone.correctElements[i] === oldId) {
          dropZone.correctElements[i] = newId;
        }
        else if (parseInt(dropZone.correctElements[i]) < id) {
          dropZone.correctElements[i] = (parseInt(dropZone.correctElements[i]) + 1).toString();
        }
      }
    });
    that.updateInternalElementIDs(0);
  };

  /**
   * Sync the internal ID of each element.
   * @param {number} start
   */
  C.prototype.updateInternalElementIDs = function (start) {
    for (var i = start; i < this.elements.length; i++) {
      this.elements[i].$element.data('id', i);
      this.elementOptions[i].value = '' + i;
    }
  };

  /**
   * Set callbacks and open dialog with the form for the given element.
   *
   * @param {Object} element
   * @returns {undefined}
   */
  C.prototype.editElement = function (element) {
    var that = this;
    var id = element.$element.data('id');

    this.doneCallback = function () {
      // Remove as correct draggable for dropzone if dropzone no longer can be dropped in a dropzone.
      const elementParams = that.params.elements[id];

      // Go through all drop zones
      for (let dzIndex = 0; dzIndex < that.params.dropZones.length; dzIndex++) {
        if (elementParams.dropZones.indexOf(dzIndex.toString()) !== -1) {
          continue; // E can still be dropped in this DZ, skip.
        }

        const correctElements = that.params.dropZones[dzIndex].correctElements;
        const isCorrect = correctElements.indexOf(id.toString());
        if (isCorrect !== -1) {
          // Element can no longer be dropped here so must be removed from correct elements for this DZ
          correctElements.splice(isCorrect, 1);
        }
      }

      // Validate form
      var valid = true;
      for (var i = 0; i < element.children.length; i++) {
        if (element.children[i].validate() === false) {
          valid = false;
          break;
        }
      }
      if (!valid) {
        return false;
      }

      // Must be removed before dnb changes focus!
      if (H5PEditor.Html) {
        H5PEditor.Html.removeWysiwyg();
      }

      // Update element
      that.updateElement(element, id);
      that.dnb.focus(element.$element);
      that.dnb.pressed = undefined;
    };

    this.removeCallback = function () {
      var i, j, ce;

      // Remove element form
      H5PEditor.removeChildren(element.children);

      // Remove element
      element.$element.remove();
      that.elements.splice(id, 1);
      that.params.elements.splice(id, 1);

      // Remove from options
      this.elementOptions.splice(id, 1);

      // Update drop zone params
      for (i = 0; i < that.params.dropZones.length; i++) {
        ce = that.params.dropZones[i].correctElements;
        for (j = 0; j < ce.length; j++) {
          if (ce[j] === '' + id) {
            // Remove from correct answers
            ce.splice(j, 1);
          }
          else if (ce[j] > id) {
            // Adjust index for others
            ce[j] = '' + (ce[j] - 1);
          }
        }
      }

      // Change data index for "all" elements
      for (i = id; i < that.elements.length; i++) {
        that.elements[i].$element.data('id', i);
        that.elementOptions[i].value = '' + i;
      }
    };

    // Disable background opacity input for DRAGGABLE if overriden globally
    var disableOpacityField = !!(that.params.elements[id].dropZones.length !== 0 && this.backgroundOpacity);    
    H5PEditor.findField('backgroundOpacity', element).$item.find('input').prop({
      disabled: disableOpacityField
    });
    if (disableOpacityField) {
      H5PEditor.findField('backgroundOpacity', element).$item.find('input').before('<div class="h5p-dragquestion-editor h5peditor-warning">' + C.t('backgroundOpacityOverridden') + '</div>');
    }
    element.children[this.elementDropZoneFieldWeight].setActive();
    this.showDialog(element.$form);

    // Blur context menu when showing dialog.
    setTimeout(function () {
      that.dnb.blurAll();
    }, 10);
  };

  /**
   * Update the element with new data.
   *
   * @param {Object} element
   * @param {int} id
   * @returns {undefined}
   */
  C.prototype.updateElement = function (element, id) {
    var self = this;
    var params = this.params.elements[id];
    // Add audio to potential element types.
    switch(params.type.library.split(' ')[0]) {
      case 'H5P.AdvancedText':
        type =  'text';
      break;
      case 'H5P.Image':
        type =  'image';
      break;
      case 'H5P.Audio':
        type =  'audio';
      break;
    }

    var hasCk = (element.children[0].children !== undefined && element.children[0].children[0].ckeditor !== undefined);
    if (type === 'text' && hasCk) {
      // Create new text instance. Replace asterisk with spans
      element.instance = H5P.newRunnable({
        library: params.type.library,
        params: {
          text: params.type.params.text.replace(/\*([^*]+)\*/g, '<span class="h5p-dragquestion-placeholder">$1</span>')
        }
      }, H5PEditor.contentId, element.$innerElement);

      // Remove asterisk from params and input field
      params.type.params.text = params.type.params.text.replace(/\*([^*]+)\*/g, '$1');
      element.children[0].children[0].ckeditor.setData(params.type.params.text);
    } else {
      // Create new instance
      element.instance = H5P.newRunnable(params.type, H5PEditor.contentId, element.$innerElement);
    }

    if (type === 'text') {
      element.$element.addClass('h5p-dq-text');
    }
      else if (type === 'image') {
      // Override image hover and use user defined hover text or none
      element.$innerElement.find('img').attr('title', params.type.params.title || '');
    }

    switch(type) {
      case 'text':
        label = $('<div>' + params.type.params.text + '</div>').text();
        element.$element.addClass('h5p-dq-text');
      break;
      case 'image':
        label = params.type.params.alt + '';
        // Override image hover and use user defined hover text or none
        element.$innerElement.find('img').attr('title', params.type.params.title || '');
      break;
      case 'audio':
        // Detect extra audio element added by the audio library and remove it if necessary.
        var audioElements = element.$innerElement.children();
        var count = audioElements.children().length;
        if (count > 1) {
            audioElements[0].remove();
        };
        if (params.type.metadata) {
          label = params.type.metadata.title;
          element.$innerElement.attr('title', label);
        } else {
          label = 'Untitled Audio';
        }
      break;
    }
    // Update correct element options
    this.elementOptions[id] = {
      value: '' + id,
      label: C.t(type) + ': ' + C.getLabel(label)
    };

    // Retain size after toggling class
    var toggleDraggable = function (addClass, $element) {
      var toggleClass = addClass !== $element.hasClass('h5p-draggable');
      if (!toggleClass) {
        return;
      }

      if (addClass) {
        $element.addClass('h5p-draggable');
      }
      else {
        $element.removeClass('h5p-draggable');
      }
    };

    if (params.dropZones !== undefined && params.dropZones.length) {
      toggleDraggable(true, element.$innerElement);
    }
    else {
      toggleDraggable(false, element.$innerElement);

      if (type === 'text' && hasCk) {
        // When dialog closes, replace spans with drop zones
        this.hideDialogCallback = function () {
          var pWidth = self.$editor.width() / 100;
          var pHeight = self.$editor.height() / 100;
          element.$element.find('.h5p-dragquestion-placeholder').each(function () {
            var $span = $(this);
            var pos = $span.position();

            // Add new drop zone
            self.params.dropZones.push({
              x: params.x + ((pos.left - 3) / pWidth),
              y: params.y + ((pos.top - 2) / pHeight),
              width: ($span.width() / self.fontSize) + 0.5,
              height: ($span.height() / self.fontSize) + 0.3,
              backgroundOpacity: 0,
              correctElements: [],
              label: C.getLabel($span.text()),
              showLabel: false
            });
            self.insertDropZone(self.params.dropZones.length - 1);

            // Remove span
            $span.contents().unwrap();
          });
          delete self.hideDialogCallback;
        };
      }
    }

    const opacity = this.getElementOpacitySetting(params);
    C.setElementOpacity(element.$element, opacity);
    element.draggable.setContentOpacity(Number(opacity));
  };

  /**
   * Clips text at 32 chars
   *
   * @param {String} text
   * @returns {String}
   */
  C.getLabel = function (text) {
    return (text.length > 32 ? text.substr(0, 32) + '...' : text);
  };

  /**
   * Insert the drop zone at the given index.
   *
   * @param {int} index
   * @returns {H5P.jQuery}
   */
  C.prototype.insertDropZone = function (index) {
    var that = this,
      dropZoneParams = this.params.dropZones[index],
      dropZone = this.generateForm(this.dropZoneFields, dropZoneParams);

    // Fake libraryName for copy&paste
    dropZoneParams.type = dropZoneParams.type || {library: that.fakeDropzoneLibrary};

    const noop = () => {};
    const dropzone = H5P.Components.Dropzone({
      variant: 'area',
      classes: 'h5p-inner',
      containerClasses: 'h5p-dq-dz',
      handleAcceptEvent: noop,
      handleDropEvent: noop,
      handleDropOutEvent: noop,
      handleDropOverEvent: noop,
    });

    dropZone.$dropZone = $(dropzone)
      .appendTo(this.$editor)
      .css({
        width: `${dropZoneParams.width}em`,
        height: `${dropZoneParams.height}em`,
        left: `${dropZoneParams.x}%`,
        top: `${dropZoneParams.y}%`,
      })
      .data('id', index)
      .dblclick(function () {
        // Edit
        that.editDropZone(dropZone);
        that.dnb.blurAll();
      });

    // Add label
    this.updateDropZone(dropZone, index);

    // Add to dnb after element has been attached
    setTimeout(function () {
      var dropzoneDnBElement = that.dnb.add(dropZone.$dropZone, DragNBar.clipboardify(clipboardKey, dropZoneParams, 'type'));

      // Register listeners for context menu buttons
      dropzoneDnBElement.contextMenu.on('contextMenuEdit', function () {
        that.editDropZone(dropZone);
        that.dnb.blurAll();
      });

      that.addAlignControl(dropzoneDnBElement);

      dropzoneDnBElement.contextMenu.on('contextMenuRemove', function () {
        that.showConfirmationDialog({
          headerText: C.t('deleteTaskTitle'),
          dialogText: C.t('confirmRemoval'),
          cancelText: C.t('cancel'),
          confirmText: C.t('confirm'),
        }, removeDropzoneDialogActions);
      });

      /**
       * Callback confirm/cancel action
       * @param {boolean} [confirmFlag] Which button is clicked
       */
      const removeDropzoneDialogActions = function (confirmFlag) {
        if (!confirmFlag) {
          return;
        }

        // Remove element form
        H5PEditor.removeChildren(dropZone.children);
        var i;
        var j;
        var id = dropZone.$dropZone.data('id');

        // Remove element
        dropZone.$dropZone.remove();
        that.dropZones.splice(id, 1);
        that.params.dropZones.splice(id, 1);

        // Remove from elements
        that.elementFields[that.elementDropZoneFieldWeight].options.splice(id, 1);

        // Remove dropZone from element params properly
        for (i = 0; i < that.params.elements.length; i++) {
          var dropZones = that.params.elements[i].dropZones;
          for (j = 0; j < dropZones.length; j++) {
            if (parseInt(dropZones[j]) === id) {
              // Remove from element drop zones
              dropZones.splice(j, 1);
              if (!dropZones.length) {
                that.elements[i].$innerElement.removeClass('h5p-draggable');
              }
            }
            else if (dropZones[j] > id) {
              // Re index other drop zones
              dropZones[j] = '' + (dropZones[j] - 1);
            }
          }
        }

        that.updateInternalDropZoneIDs(id);
        that.dnb.blurAll();
      };

      dropzoneDnBElement.contextMenu.on('contextMenuBringToFront', function () {
        var id = dropZone.$dropZone.data('id');

        // Update visuals
        dropZone.$dropZone.appendTo(that.$editor);

        // Get new ID
        that.dropZones.push(that.dropZones.splice(id, 1)[0]);
        that.params.dropZones.push(that.params.dropZones.splice(id, 1)[0]);
        var options = that.elementFields[that.elementDropZoneFieldWeight].options;
        options.push(options.splice(id, 1)[0]);
        var newID = (that.dropZones.length - 1);

        // Update dropZone IDs in element params
        for (var i = 0; i < that.params.elements.length; i++) {
          var dropZones = that.params.elements[i].dropZones;
          for (var j = 0; j < dropZones.length; j++) {
            if (parseInt(dropZones[j]) === id) {
              // Update ID
              dropZones[j] = newID;
            }
            else if (dropZones[j] > id) {
              // Re-index other drop zones
              dropZones[j] = '' + (dropZones[j] - 1);
            }
          }
        }

        that.updateInternalDropZoneIDs(id);
      });

      dropzoneDnBElement.contextMenu.on('contextMenuSendToBack', function () {
        var id = dropZone.$dropZone.data('id');

        // Update visuals
        dropZone.$dropZone.prependTo(that.$editor);

        // Get new ID
        that.dropZones.unshift(that.dropZones.splice(id, 1)[0]);
        that.params.dropZones.unshift(that.params.dropZones.splice(id, 1)[0]);
        var options = that.elementFields[that.elementDropZoneFieldWeight].options;
        options.unshift(options.splice(id, 1)[0]);
        var newID = (that.dropZones.length - 1);

        // Update dropZone IDs in element params
        for (var i = 0; i < that.params.elements.length; i++) {
          var dropZones = that.params.elements[i].dropZones;
          for (var j = 0; j < dropZones.length; j++) {
            if (parseInt(dropZones[j]) === id) {
              // Update ID
              dropZones[j] = newID;
            }
            else if (dropZones[j] < id) {
              // Re-index other drop zones
              dropZones[j] = '' + (dropZones[j] + 1);
            }
          }
        }

        that.updateInternalDropZoneIDs(id);
      });
      that.dnb.focus(dropZone.$dropZone);
    }, 0);

    this.dropZones[index] = dropZone;
    return dropZone.$dropZone;
  };

  /**
   * Sync the internal ID of each drop zone.
   * @param {number} start
   */
  C.prototype.updateInternalDropZoneIDs = function (start) {
    for (var i = start; i < this.dropZones.length; i++) {
      this.dropZones[i].$dropZone.data('id', i);
      this.elementFields[this.elementDropZoneFieldWeight].options[i].value = i + '';
    }
  };

  /**
   * Set callbacks and open dialog with the form for the given drop zone.
   *
   * @param {Object} dropZone
   * @returns {undefined}
   */
  C.prototype.editDropZone = function (dropZone) {
    var that = this;
    var i, j, id = dropZone.$dropZone.data('id');

    this.doneCallback = function () {
      // Validate form
      var valid = true;
      for (var i = 0; i < dropZone.children.length; i++) {
        if (dropZone.children[i].validate() === false) {
          valid = false;
          break;
        }
      }
      if (!valid) {
        return false;
      }

      // Must be removed before dnb changes focus!
      if (H5PEditor.Html) {
        H5PEditor.Html.removeWysiwyg();
      }

      that.updateDropZone(dropZone, id);
      that.dnb.focus(dropZone.$dropZone);
      that.dnb.pressed = undefined;
    };

    this.removeCallback = function () {
      // Remove element form
      H5PEditor.removeChildren(dropZone.children);

      // Remove element
      dropZone.$dropZone.remove();
      that.dropZones.splice(id, 1);
      that.params.dropZones.splice(id, 1);

      // Remove from elements
      this.elementFields[this.elementDropZoneFieldWeight].options.splice(id, 1);

      // Remove dropZone from element params properly
      for (i = 0; i < that.params.elements.length; i++) {
        var dropZones = that.params.elements[i].dropZones;
        for (j = 0; j < dropZones.length; j++) {
          if (parseInt(dropZones[j]) === id) {
            // Remove from element drop zones
            dropZones.splice(j, 1);
            if (!dropZones.length) {
              that.elements[i].$element.removeClass('h5p-draggable');
            }
          }
          else if (dropZones[j] > id) {
            // Re index other drop zones
            dropZones[j] = '' + (dropZones[j] - 1);
          }
        }
      }

      // Reindex all dropzones
      for (i = id; i < that.dropZones.length; i++) {
        that.dropZones[i].$dropZone.data('id', i);
        this.elementFields[this.elementDropZoneFieldWeight].options[i].value = i + '';
      }
    };

    // Add only available options
    var options = this.dropZoneFields[this.dropZoneElementFieldWeight].options = [];
    var dropZones;
    for (i = 0; i < this.elementOptions.length; i++) {
      dropZones = this.params.elements[i].dropZones;
      for (j = 0; j < dropZones.length; j++) {
        if (dropZones[j] === (id + '')) {
          options.push(this.elementOptions[i]);
          break;
        }
      }
    }

    // Disable background opacity input for dropzones if overriden globally
    var disableOpacityField = !!(that.params.dropZones[id].correctElements.length !== 0 && this.backgroundOpacityDropZones);    
    var $previous = H5PEditor.findField('backgroundOpacity', dropZone).$item.find('input').prev();
    var $hasWarning = $previous.hasClass( 'h5peditor-warning' )
    if ($hasWarning) {
      $previous.remove();
    }
    H5PEditor.findField('backgroundOpacity', dropZone).$item.find('input').prop({
      disabled: disableOpacityField
    });
    if (disableOpacityField) {
      H5PEditor.findField('backgroundOpacity', dropZone).$item.find('input').before('<div class="h5p-dragquestion-editor h5peditor-warning">' + C.t('backgroundOpacityOverridden') + '</div>');
    }

    dropZone.children[this.dropZoneElementFieldWeight].setActive();
    this.showDialog(dropZone.$form);

    // Blur context menu when showing dialog
    setTimeout(function () {
      that.dnb.blurAll();
    }, 10);
  };

  /**
   * Remove old label and add new.
   *
   * @param {Object} dropZone
   * @param {int} id
   * @returns {undefined}
   */
  C.prototype.updateDropZone = function (dropZone, id) {
    var params = this.params.dropZones[id];
    // Remove old label and add new.
    dropZone.$dropZone.children('.h5p-dq-dz-label').remove();
    if (params.showLabel === true) {
      $('<div class="h5p-dq-dz-label">' + params.label + '</div>').appendTo(dropZone.$dropZone);
      dropZone.$dropZone.addClass('h5p-has-label');
    }
    else {
      dropZone.$dropZone.removeClass('h5p-has-label');
    }

    // Create/update Tip:
    dropZone.$dropZone.children('.joubel-tip-container').remove();
    if (params.tipsAndFeedback !== undefined && params.tipsAndFeedback.tip !== undefined && params.tipsAndFeedback.tip.trim().length !== 0) {
      dropZone.$dropZone.append(H5P.JoubelUI.createTip(params.tipsAndFeedback.tip, {showSpeechBubble: false}));
    }

    this.elementFields[this.elementDropZoneFieldWeight].options[id] = {
      value: '' + id,
      label: params.label
    };
    if (this.backgroundOpacityDropZones === undefined) {
      opacity = params.backgroundOpacity;
    } else {
      opacity = this.backgroundOpacityDropZones;
    }
    // JR Add tooltip title to make editing easier for dropzones where label is not displayed.
    $element = dropZone.$dropZone.add(dropZone.$dropZone.children('.h5p-dq-dz-label'));
    if (!params.showLabel) {
      title = C.getLabel($(params.label).text());
      $element.prop({
        title: title
      });
    }

    C.setOpacity(dropZone.$dropZone.children('.h5p-inner'), 'background', params.backgroundOpacity);
    C.setOpacity(dropZone.$dropZone.children('.h5p-dq-dz-label'), 'background', params.backgroundOpacity);
  };

  /**
   * Attach form to dialog and show.
   *
   * @param {jQuery} $form
   * @returns {undefined}
   */
  C.prototype.showDialog = function ($form) {
    this.dnb.blurAll();
    this.$currentForm = $form;
    $form.appendTo(this.$dialogInner);
    this.$dialog.show();
    this.$editor.add(this.$dnbWrapper).hide();
    this.dnb.dnr.toggleModifiers(false);
  };

  /**
   * Hide dialog and detach form.
   *
   * @returns {undefined}
   */
  C.prototype.hideDialog = function () {
    // Attempt to find and close CKEditor instances before detaching.


    this.$currentForm.detach();
    this.$dialog.hide();
    this.$editor.add(this.$dnbWrapper).show();

    if (this.hideDialogCallback !== undefined) {
      this.hideDialogCallback();
    }
    this.dnb.dnr.toggleModifiers(true);
  };

  /**
   * Update the opacity of the draggables (H5P.Components.Draggable).
   * @returns {undefined}
   */
  C.prototype.updateDraggableOpacity = function () {
    if (this.backgroundOpacity && this.elements) {
      this.elements.forEach(element => {
        element.draggable.setContentOpacity(Number(this.backgroundOpacity));
      });
    }
  };

  /**
   * Update transparency for background.
   *
   * @param {jQuery} $element
   * @param {Number} opacity
   */
  C.setElementOpacity = function ($element, opacity) {
    C.setOpacity($element, 'background', opacity);
    C.setOpacity($element, 'boxShadow', opacity);
    C.setOpacity($element, 'borderColor', opacity);
  };

  /**
   * Update all elements' opacity
   *
   * @param {Array} domElements
   * @param {Array} elements
   * @param {String} type
   */
  C.prototype.updateAllElementsOpacity = function (domElements, elements, type) {
    if (domElements === undefined) {
      return;
    }

    for (var i = 0; i < domElements.length; i++) {
      C.setElementOpacity(domElements[i]['$' + type], this.getElementOpacitySetting(elements[i]));
    }
  };

  /**
   * Get the opacity setting for a given element
   *
   * @param {Object} element
   * @returns {String} opacity
   */
  C.prototype.getElementOpacitySetting = function (element) {
    if ((element.dropZones !== undefined && element.dropZones.length === 0) ||
       (this.backgroundOpacity === undefined)) {
      return element.backgroundOpacity;
    }

    return this.backgroundOpacity;
  };

  /**
   * Makes element background, border and shadow transparent.
   *
   * @param {jQuery} $element
   * @param {String} property
   * @param {Number} opacity
   */
  C.setOpacity = function ($element, property, opacity) {
    if (property === 'background') {
      // Set both color and gradient.
      C.setOpacity($element, 'backgroundColor', opacity);
      C.setOpacity($element, 'backgroundImage', opacity);
      return;
    }

    opacity = (opacity === undefined ? 1 : opacity / 100);

    // Private. Get css properties objects.
    function getProperties(property, value) {
      switch (property) {
        case 'borderColor':
          return {
            borderTopColor: value,
            borderRightColor: value,
            borderBottomColor: value,
            borderLeftColor: value
          };

        default:
          var properties = {};
          properties[property] = value;
          return properties;
      }
    }

    // Reset css to be sure we're using CSS and not inline values.
    var properties = getProperties(property, '');
    $element.css(properties);

    for (var prop in properties) {
      break;
    }
    var style = $element.css(prop); // Assume all props are the same and use the first.
    style = C.setAlphas(style, 'rgba(', opacity); // Update rgba
    style = C.setAlphas(style, 'rgb(', opacity); // Convert rgb

    $element.css(getProperties(property, style));
  };

  /**
   * Updates alpha channel for colors in the given style.
   *
   * @param {String} style
   * @param {String} prefix
   * @param {Number} alpha
   */
  C.setAlphas = function (style, prefix, alpha) {
    // Style undefined
    if (!style) {
      return;
    }
    var colorStart = style.indexOf(prefix);

    while (colorStart !== -1) {
      var colorEnd = style.indexOf(')', colorStart);
      var channels = style.substring(colorStart + prefix.length, colorEnd).split(',');

      // Set alpha channel
      channels[3] = (channels[3] !== undefined ? parseFloat(channels[3]) * alpha : alpha);

      style = style.substring(0, colorStart) + 'rgba(' + channels.join(',') + style.substring(colorEnd, style.length);

      // Look for more colors
      colorStart = style.indexOf(prefix, colorEnd);
    }

    return style;
  };

  /**
   * Validate the current field.
   *
   * @returns {Boolean}
   */
  C.prototype.validate = function () {
    return true;
  };

  /**
   * Remove the field from DOM.
   *
   * @returns {undefined}
   */
  C.prototype.remove = function () {
    this.clearMultiSelection();
    this.closeAlignPanels();
    this.removeMultiSelectionHandlers();
    if (this.dnb !== undefined) {
      this.dnb.remove();
    }
    this.$item.remove();
  };

  /**
   * Collect functions to execute once the tree is complete.
   *
   * @param {function} ready
   * @returns {undefined}
   */
  C.prototype.ready = function (ready) {
    if (this.passReadies) {
      this.parent.ready(ready);
    }
    else {
      this.readies.push(ready);
    }
  };

  /**
   * Add confirmation dialog to button.
   * @param {object} dialogOptions Dialog options.
   * @param {function} handleActions Handle both actions Confirmed and Canceled.
   */
  C.prototype.showConfirmationDialog = function (dialogOptions, handleActions) {
    const confirmationDialog = new H5P.ConfirmationDialog(dialogOptions)
      .appendTo(document.body);

    confirmationDialog.on('confirmed', () => {
      if (handleActions) {
        handleActions(true);
      }
    });

    confirmationDialog.on('canceled', () => {
      if (handleActions) {
        handleActions(false);
      }
    });

    confirmationDialog.show(this.$item.offset().top);
  };

  /**
   * Translate UI texts for this library.
   *
   * @param {String} key
   * @param {Object} vars
   * @returns {@exp;H5PEditor@call;t}
   */
  C.t = function (key, vars) {
    return H5PEditor.t('H5PEditor.DragQuestionPapiJo', key, vars);
  };

  return C;
})(H5P.jQuery, H5P.DragNBar);
