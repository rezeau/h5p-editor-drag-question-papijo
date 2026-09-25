'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeClassList {
  constructor(classes = []) {
    this.classes = new Set(classes);
  }

  add(className) {
    this.classes.add(className);
  }

  remove(className) {
    this.classes.delete(className);
  }

  contains(className) {
    return this.classes.has(className);
  }
}

class FakeElement {
  constructor(classes = [], parentNode = null) {
    this.classList = new FakeClassList(classes);
    this.parentNode = parentNode;
    this.listeners = {};
  }

  addEventListener(type, listener, capture) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push({listener, capture});
  }

  removeEventListener(type, listener, capture) {
    this.listeners[type] = (this.listeners[type] || []).filter((entry) => {
      return entry.listener !== listener || entry.capture !== capture;
    });
  }
}

class FakeJQuery {
  constructor(element) {
    this[0] = element;
    this.length = element ? 1 : 0;
  }

  addClass(className) {
    this[0].classList.add(className);
    return this;
  }

  removeClass(className) {
    this[0].classList.remove(className);
    return this;
  }

  add() {
    return this;
  }

  appendTo(target) {
    this[0].appendedTo = target[0];
    return this;
  }

  hide() {
    this[0].hidden = true;
    return this;
  }

  show() {
    this[0].hidden = false;
    return this;
  }
}

function $(element) {
  return element instanceof FakeJQuery ? element : new FakeJQuery(element);
}

function loadEditor() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'H5PEditor.DragQuestion.js'), 'utf8');
  const context = {
    H5PEditor: {widgets: {}},
    H5P: {jQuery: $, DragNBar: function () {}},
  };
  vm.runInNewContext(source, context);
  return context.H5PEditor.DragQuestion;
}

const DragQuestion = loadEditor();

function setup() {
  const editor = new FakeElement(['h5peditor-dragquestion']);
  const primary = new FakeElement(['h5p-dragnbar-element', 'focused'], editor);
  const draggable = new FakeElement(['h5p-dragnbar-element', 'h5p-dq-element'], editor);
  const dropZone = new FakeElement(['h5p-dragnbar-element', 'h5p-dq-dz'], editor);
  const instance = Object.create(DragQuestion.prototype);

  instance.$editor = $(editor);
  instance.secondarySelections = [];
  instance.dnb = {
    focusedElement: {
      getElement: () => $(primary),
    },
  };

  return {instance, editor, primary, draggable, dropZone};
}

function mouseEvent(target, options = {}) {
  return {
    target,
    button: options.button === undefined ? 0 : options.button,
    ctrlKey: Boolean(options.ctrlKey),
    shiftKey: Boolean(options.shiftKey),
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
  };
}

test('Ctrl+mousedown adds a secondary and blocks DragNBar handling', () => {
  const {instance, draggable} = setup();
  const event = mouseEvent(draggable, {ctrlKey: true});

  instance.handleMultiSelectionMouseDown(event);

  assert.equal(instance.isSecondarySelected(draggable), true);
  assert.equal(draggable.classList.contains('papijo-secondary-selected'), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test('Shift+mousedown has the same additive behavior', () => {
  const {instance, dropZone} = setup();

  instance.handleMultiSelectionMouseDown(mouseEvent(dropZone, {shiftKey: true}));

  assert.equal(instance.isSecondarySelected(dropZone), true);
});

test('modifier-mousedown toggles an existing secondary off', () => {
  const {instance, draggable} = setup();
  instance.addSecondarySelection(draggable);

  instance.handleMultiSelectionMouseDown(mouseEvent(draggable, {ctrlKey: true}));

  assert.equal(instance.isSecondarySelected(draggable), false);
  assert.equal(draggable.classList.contains('papijo-secondary-selected'), false);
});

test('modifier-mousedown on the primary does not toggle it', () => {
  const {instance, primary} = setup();
  const event = mouseEvent(primary, {ctrlKey: true});

  instance.handleMultiSelectionMouseDown(event);

  assert.deepEqual(instance.secondarySelections, []);
  assert.equal(primary.classList.contains('papijo-secondary-selected'), false);
  assert.equal(primary.classList.contains('focused'), true);
  assert.equal(event.propagationStopped, true);
});

test('mixed draggable and drop-zone secondary selections are supported', () => {
  const {instance, draggable, dropZone} = setup();

  instance.handleMultiSelectionMouseDown(mouseEvent(draggable, {ctrlKey: true}));
  instance.handleMultiSelectionMouseDown(mouseEvent(dropZone, {shiftKey: true}));

  assert.equal(instance.secondarySelections.length, 2);
  assert.equal(instance.isSecondarySelected(draggable), true);
  assert.equal(instance.isSecondarySelected(dropZone), true);
});

test('normal mousedown clears all secondary selections', () => {
  const {instance, draggable, dropZone} = setup();
  instance.addSecondarySelection(draggable);
  instance.addSecondarySelection(dropZone);

  const event = mouseEvent(dropZone);
  instance.handleMultiSelectionMouseDown(event);

  assert.equal(instance.secondarySelections.length, 0);
  assert.equal(draggable.classList.contains('papijo-secondary-selected'), false);
  assert.equal(dropZone.classList.contains('papijo-secondary-selected'), false);
  assert.equal(event.propagationStopped, false);
  assert.equal(event.defaultPrevented, false);
});

test('the click following modifier-mousedown stays suppressed if the key is released', () => {
  const {instance, draggable} = setup();
  instance.handleMultiSelectionMouseDown(mouseEvent(draggable, {ctrlKey: true}));
  const click = mouseEvent(draggable);

  instance.handleMultiSelectionClick(click);

  assert.equal(instance.isSecondarySelected(draggable), true);
  assert.equal(click.propagationStopped, true);
  assert.equal(click.defaultPrevented, true);
});

test('a synthetic modifier-click toggles without a preceding mousedown', () => {
  const {instance, dropZone} = setup();
  const click = mouseEvent(dropZone, {shiftKey: true});

  instance.handleMultiSelectionClick(click);

  assert.equal(instance.isSecondarySelected(dropZone), true);
  assert.equal(click.propagationStopped, true);
});

test('changing the DragNBar primary clears secondary state before focusing', () => {
  const {instance, primary, draggable, dropZone} = setup();
  instance.addSecondarySelection(draggable);
  let focused = null;
  let blurred = false;
  instance.dnb.focus = ($element) => {
    focused = $element[0];
  };
  instance.dnb.blurAll = () => {
    blurred = true;
  };

  instance.initializeMultiSelection();
  instance.dnb.focus($(dropZone));

  assert.equal(focused, dropZone);
  assert.equal(instance.secondarySelections.length, 0);

  instance.addSecondarySelection(draggable);
  instance.dnb.focusedElement = {getElement: () => $(primary)};
  instance.dnb.blurAll();
  assert.equal(blurred, true);
  assert.equal(instance.secondarySelections.length, 0);
});

test('refocusing the current primary preserves secondary state', () => {
  const {instance, primary, draggable} = setup();
  instance.addSecondarySelection(draggable);
  let focused = null;
  instance.dnb.focus = ($element) => {
    focused = $element[0];
  };
  instance.dnb.blurAll = () => {};

  instance.initializeMultiSelection();
  instance.addSecondarySelection(draggable);
  instance.dnb.focus($(primary));

  assert.equal(focused, primary);
  assert.equal(instance.isSecondarySelected(draggable), true);
});

test('opening an edit dialog clears multi-selection through wrapped blurAll', () => {
  const {instance, draggable} = setup();
  const dialog = new FakeElement();
  const dialogInner = new FakeElement();
  const toolbar = new FakeElement();
  const form = new FakeElement();
  let blurCalls = 0;
  let modifiersEnabled = true;

  instance.dnb.focus = () => {};
  instance.dnb.blurAll = () => {
    blurCalls++;
  };
  instance.dnb.dnr = {
    toggleModifiers: (enabled) => {
      modifiersEnabled = enabled;
    },
  };
  instance.$dialog = $(dialog);
  instance.$dialogInner = $(dialogInner);
  instance.$dnbWrapper = $(toolbar);
  instance.initializeMultiSelection();
  instance.addSecondarySelection(draggable);

  instance.showDialog($(form));

  assert.equal(blurCalls, 1);
  assert.equal(instance.secondarySelections.length, 0);
  assert.equal(draggable.classList.contains('papijo-secondary-selected'), false);
  assert.equal(form.appendedTo, dialogInner);
  assert.equal(dialog.hidden, false);
  assert.equal(modifiersEnabled, false);
});

test('post-removal blur clears detached secondary references and classes', () => {
  const {instance, draggable, dropZone} = setup();
  let blurCalls = 0;

  instance.dnb.focus = () => {};
  instance.dnb.blurAll = () => {
    blurCalls++;
  };
  instance.initializeMultiSelection();
  instance.addSecondarySelection(draggable);
  instance.addSecondarySelection(dropZone);

  // Confirmed removal detaches an element before the existing blurAll call.
  draggable.parentNode = null;
  instance.dnb.blurAll();

  assert.equal(blurCalls, 1);
  assert.equal(instance.secondarySelections.length, 0);
  assert.equal(draggable.classList.contains('papijo-secondary-selected'), false);
  assert.equal(dropZone.classList.contains('papijo-secondary-selected'), false);
});

test('new-object focus used by create and paste clears old secondaries', () => {
  const {instance, draggable, dropZone} = setup();
  let focused = null;

  instance.dnb.focus = ($element) => {
    focused = $element[0];
  };
  instance.dnb.blurAll = () => {};
  instance.initializeMultiSelection();
  instance.addSecondarySelection(draggable);

  instance.dnb.focus($(dropZone));

  assert.equal(focused, dropZone);
  assert.equal(instance.secondarySelections.length, 0);
  assert.equal(draggable.classList.contains('papijo-secondary-selected'), false);
});

test('z-order ID changes preserve selection on the same DOM objects', () => {
  const {instance, draggable, dropZone} = setup();
  instance.addSecondarySelection(draggable);
  instance.addSecondarySelection(dropZone);

  // Bring-to-front/send-to-back and reindexing update IDs, not DOM objects.
  draggable.dataId = 4;
  dropZone.dataId = 0;

  assert.equal(instance.isSecondarySelected(draggable), true);
  assert.equal(instance.isSecondarySelected(dropZone), true);
  assert.equal(instance.secondarySelections[0], draggable);
  assert.equal(instance.secondarySelections[1], dropZone);
});

test('teardown and reinitialization do not duplicate capture handlers', () => {
  const {instance, editor, draggable} = setup();
  instance.dnb.focus = () => {};
  instance.dnb.blurAll = () => {};

  instance.initializeMultiSelection();
  instance.addSecondarySelection(draggable);
  assert.equal(editor.listeners.mousedown.length, 1);
  assert.equal(editor.listeners.click.length, 1);

  // Mirrors the selection/listener cleanup performed by remove/activateEditor.
  instance.clearMultiSelection();
  instance.removeMultiSelectionHandlers();
  instance.dnb = {
    focus: () => {},
    blurAll: () => {},
  };
  instance.initializeMultiSelection();

  assert.equal(editor.listeners.mousedown.length, 1);
  assert.equal(editor.listeners.click.length, 1);
  assert.equal(instance.secondarySelections.length, 0);
  assert.equal(draggable.classList.contains('papijo-secondary-selected'), false);
});
