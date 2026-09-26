'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeElement {
  constructor(classes, rect, computedStyle = {}) {
    this.classes = new Set(classes || []);
    this.rect = {...rect};
    this.computedStyle = {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      fontSize: '10px',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      ...computedStyle,
    };
    this.dataStore = {};
    this.appliedStyles = {};
  }

  getBoundingClientRect() {
    return {...this.rect};
  }
}

class FakeJQuery {
  constructor(element) {
    this[0] = element;
    this.length = element ? 1 : 0;
  }

  hasClass(className) {
    return this[0].classes.has(className);
  }

  data(key, value) {
    if (value !== undefined) {
      this[0].dataStore[key] = value;
      return this;
    }
    return this[0].dataStore[key];
  }

  css(styles) {
    Object.assign(this[0].appliedStyles, styles);
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
    window: {
      getComputedStyle: (element) => element.computedStyle,
    },
  };
  vm.runInNewContext(source, context);
  return context.H5PEditor.DragQuestion;
}

const DragQuestion = loadEditor();

function setup() {
  const editor = new FakeElement([], {
    left: 100,
    top: 50,
    width: 504,
    height: 304,
  }, {
    width: '500px',
    height: '300px',
    fontSize: '10px',
    borderLeftWidth: '2px',
    borderRightWidth: '2px',
    borderTopWidth: '2px',
    borderBottomWidth: '2px',
  });
  const draggable = new FakeElement(['h5p-dq-element'], {
    left: 142,
    top: 82,
    width: 90,
    height: 50,
  }, {
    width: '80px',
    height: '40px',
    boxSizing: 'content-box',
  });
  const dropZone = new FakeElement(['h5p-dq-dz'], {
    left: 252,
    top: 102,
    width: 120,
    height: 60,
  }, {
    width: '120px',
    height: '60px',
    boxSizing: 'border-box',
  });
  const draggableParams = {x: 8, y: 10, width: 8, height: 4};
  const dropZoneParams = {x: 30, y: 16.6666666667, width: 12, height: 6};
  const draggableObject = {$element: $(draggable)};
  const dropZoneObject = {$dropZone: $(dropZone)};
  const instance = Object.create(DragQuestion.prototype);

  $(draggable).data('id', 0);
  $(dropZone).data('id', 0);
  instance.$editor = $(editor);
  instance.elements = [draggableObject];
  instance.dropZones = [dropZoneObject];
  instance.params = {
    elements: [draggableParams],
    dropZones: [dropZoneParams],
  };
  instance.secondarySelections = [];
  instance.dnb = {
    dnr: {containerEm: 10},
    focusedElement: {getElement: () => $(draggable)},
  };

  return {
    instance,
    editor,
    draggable,
    dropZone,
    draggableParams,
    dropZoneParams,
    draggableObject,
    dropZoneObject,
  };
}

function rect(left, top, width, height) {
  return {left, top, width, height};
}

test('resolves draggable and drop-zone elements to current editor objects', () => {
  const {instance, draggable, dropZone, draggableParams, dropZoneParams} = setup();

  const resolvedDraggable = instance.resolveGeometryObject(draggable);
  const resolvedDropZone = instance.resolveGeometryObject(dropZone);

  assert.equal(resolvedDraggable.type, 'draggable');
  assert.equal(resolvedDraggable.id, 0);
  assert.equal(resolvedDraggable.params, draggableParams);
  assert.equal(resolvedDraggable.element, draggable);
  assert.equal(resolvedDropZone.type, 'dropZone');
  assert.equal(resolvedDropZone.id, 0);
  assert.equal(resolvedDropZone.params, dropZoneParams);
  assert.equal(resolvedDropZone.element, dropZone);
});

test('resolves the current ID after a reindex change', () => {
  const {instance, draggable, draggableParams, draggableObject} = setup();
  const otherElement = new FakeElement(['h5p-dq-element'], rect(0, 0, 30, 30));
  const otherParams = {x: 0, y: 0, width: 3, height: 3};

  instance.elements = [{$element: $(otherElement)}, draggableObject];
  instance.params.elements = [otherParams, draggableParams];
  $(otherElement).data('id', 0);
  $(draggable).data('id', 1);

  const resolved = instance.resolveGeometryObject(draggable);
  assert.equal(resolved.id, 1);
  assert.equal(resolved.params, draggableParams);
});

test('complete geometry selection returns primary first', () => {
  const {instance, draggable, dropZone} = setup();
  instance.dnb.focusedElement = {getElement: () => $(dropZone)};
  instance.secondarySelections = [draggable];

  const selection = instance.getGeometrySelection();

  assert.equal(selection.length, 2);
  assert.equal(selection[0].element, dropZone);
  assert.equal(selection[1].element, draggable);
});

test('measures rendered outer rectangle relative to the editor inner edge', () => {
  const {instance, draggable} = setup();

  const measured = instance.measureGeometryObject(draggable);

  assert.deepEqual({...measured}, {
    left: 40,
    top: 30,
    width: 90,
    height: 50,
    right: 130,
    bottom: 80,
    centerX: 85,
    centerY: 55,
  });
});

test('converts rendered pixel positions using current editor dimensions', () => {
  const {instance, editor} = setup();

  assert.deepEqual({...instance.convertRenderedPositionToPercent(125, 75)}, {x: 25, y: 25});

  editor.rect.width = 254;
  editor.rect.height = 154;
  editor.computedStyle.width = '250px';
  editor.computedStyle.height = '150px';
  assert.deepEqual({...instance.convertRenderedPositionToPercent(125, 75)}, {x: 50, y: 50});
});

test('converts desired content-box outer size to persisted em', () => {
  const {instance, draggable} = setup();

  const size = instance.convertRenderedOuterSizeToEm(draggable, 120, 70);

  assert.deepEqual({...size}, {width: 11, height: 6});
});

test('converts desired border-box outer size to persisted em', () => {
  const {instance, dropZone} = setup();

  const size = instance.convertRenderedOuterSizeToEm(dropZone, 150, 80);

  assert.deepEqual({...size}, {width: 15, height: 8});
});

test('outer-size conversion uses the current rendered editor em', () => {
  const {instance, editor, dropZone} = setup();
  editor.computedStyle.fontSize = '8px';
  instance.dnb.dnr.containerEm = 12;

  const size = instance.convertRenderedOuterSizeToEm(dropZone, 80);

  assert.deepEqual({...size}, {width: 10});
});

test('supports width-only and height-only outer-size conversion', () => {
  const {instance, draggable} = setup();

  assert.deepEqual({...instance.convertRenderedOuterSizeToEm(draggable, 120)}, {width: 11});
  assert.deepEqual({...instance.convertRenderedOuterSizeToEm(draggable, undefined, 70)}, {height: 6});
});

test('accepts normal and exact-edge rectangles within bounds', () => {
  const {instance} = setup();

  assert.equal(instance.isGeometryRectWithinBounds(rect(20, 30, 100, 80)), true);
  assert.equal(instance.isGeometryRectWithinBounds(rect(400, 250, 100, 50)), true);
});

test('rejects each canvas boundary violation', () => {
  const {instance} = setup();

  assert.equal(instance.isGeometryRectWithinBounds(rect(-1, 0, 10, 10)), false);
  assert.equal(instance.isGeometryRectWithinBounds(rect(0, -1, 10, 10)), false);
  assert.equal(instance.isGeometryRectWithinBounds(rect(491, 0, 10, 10)), false);
  assert.equal(instance.isGeometryRectWithinBounds(rect(0, 291, 10, 10)), false);
});

test('requested-size validation applies the 24px minimum only to requested axes', () => {
  const {instance} = setup();

  assert.equal(instance.isRequestedGeometrySizeValid({width: 24, height: 24}), true);
  assert.equal(instance.isRequestedGeometrySizeValid({width: 23}), false);
  assert.equal(instance.isRequestedGeometrySizeValid({height: 23}), false);
  assert.equal(instance.isRequestedGeometrySizeValid({}), true);
});

test('legacy sub-24px geometry remains valid for position-only updates', () => {
  const {instance, draggable} = setup();
  draggable.rect.width = 20;
  draggable.rect.height = 18;
  draggable.computedStyle.width = '10px';
  draggable.computedStyle.height = '8px';

  const update = instance.prepareGeometryUpdate(draggable, {left: 50, top: 40});

  assert.equal(instance.validateGeometryPlan([update]), true);
});

test('valid prepared update changes DOM and params consistently', () => {
  const {instance, draggable, draggableParams} = setup();
  const update = instance.prepareGeometryUpdate(draggable, {
    left: 100,
    top: 60,
    width: 120,
    height: 70,
  });

  assert.equal(instance.applyGeometryPlan([update]), true);
  assert.deepEqual(draggable.appliedStyles, {
    left: '20%',
    top: '20%',
    width: '11em',
    height: '6em',
  });
  assert.deepEqual(draggableParams, {x: 20, y: 20, width: 11, height: 6});
});

test('invalid multi-object plan modifies nothing', () => {
  const {instance, draggable, dropZone, draggableParams, dropZoneParams} = setup();
  const originalDraggableParams = {...draggableParams};
  const originalDropZoneParams = {...dropZoneParams};
  const valid = instance.prepareGeometryUpdate(draggable, {left: 100});
  const invalid = instance.prepareGeometryUpdate(dropZone, {left: 450});

  assert.equal(instance.applyGeometryPlan([valid, invalid]), false);
  assert.deepEqual(draggable.appliedStyles, {});
  assert.deepEqual(dropZone.appliedStyles, {});
  assert.deepEqual(draggableParams, originalDraggableParams);
  assert.deepEqual(dropZoneParams, originalDropZoneParams);
});

test('mixed draggable/drop-zone prepared size plan accounts for each box model', () => {
  const {instance, draggable, dropZone, draggableParams, dropZoneParams} = setup();
  const draggableUpdate = instance.prepareGeometryUpdate(draggable, {width: 100});
  const dropZoneUpdate = instance.prepareGeometryUpdate(dropZone, {width: 100});

  assert.equal(instance.applyGeometryPlan([draggableUpdate, dropZoneUpdate]), true);
  assert.equal(draggableParams.width, 9);
  assert.equal(dropZoneParams.width, 10);
  assert.equal(draggable.appliedStyles.width, '9em');
  assert.equal(dropZone.appliedStyles.width, '10em');
});
