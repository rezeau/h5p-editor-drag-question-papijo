'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const labels = {
  align: 'Align',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  alignTop: 'Align top',
  alignMiddle: 'Align middle',
  alignBottom: 'Align bottom',
};

class FakeElement {
  constructor(classes = [], rect = {}, computedStyle = {}) {
    this.classes = new Set(classes);
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
    this.rect = {...rect};
    this.computedStyle = {
      width: `${rect.width || 0}px`,
      height: `${rect.height || 0}px`,
      fontSize: '10px',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      ...computedStyle,
    };
    this.dataStore = {};
    this.appliedStyles = {};
    this.attributes = {};
    this.children = [];
    this.events = {};
    this.hidden = false;
    this.listeners = {};
  }

  getBoundingClientRect() {
    return {...this.rect};
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

  hasClass(name) {
    return this[0].classes.has(name);
  }

  addClass(name) {
    this[0].classes.add(name);
    return this;
  }

  removeClass(name) {
    this[0].classes.delete(name);
    return this;
  }

  toggleClass(name, state) {
    if (state === undefined ? !this.hasClass(name) : state) {
      this.addClass(name);
    }
    else {
      this.removeClass(name);
    }
    return this;
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

  attr(name, value) {
    if (value === undefined) {
      return this[0].attributes[name];
    }
    this[0].attributes[name] = value;
    return this;
  }

  text(value) {
    this[0].text = value;
    return this;
  }

  on(type, listener) {
    this[0].events[type] = listener;
    return this;
  }

  appendTo(target) {
    target[0].children.push(this[0]);
    this[0].parent = target[0];
    return this;
  }

  find(selector) {
    const className = selector.replace('.', '');
    return new FakeJQuery(this[0].children.find((child) => child.classes.has(className)));
  }

  hide() {
    this[0].hidden = true;
    return this;
  }

  toggle(state) {
    this[0].hidden = state === undefined ? !this[0].hidden : !state;
    return this;
  }

  is(selector) {
    return selector === ':visible' && !this[0].hidden;
  }
}

function $(value) {
  if (value instanceof FakeJQuery) {
    return value;
  }
  if (typeof value === 'string') {
    const classMatch = value.match(/class="([^"]+)"/);
    return new FakeJQuery(new FakeElement(classMatch ? classMatch[1].split(' ') : []));
  }
  return new FakeJQuery(value);
}

function loadEditor() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'H5PEditor.DragQuestion.js'), 'utf8');
  const context = {
    H5PEditor: {
      widgets: {},
      t: (library, key) => labels[key] || key,
    },
    H5P: {jQuery: $, DragNBar: function () {}},
    window: {getComputedStyle: (element) => element.computedStyle},
  };
  vm.runInNewContext(source, context);
  return context.H5PEditor.DragQuestion;
}

const DragQuestion = loadEditor();

function setup() {
  const editor = new FakeElement([], {left: 100, top: 50, width: 504, height: 304}, {
    width: '500px',
    height: '300px',
    borderLeftWidth: '2px',
    borderRightWidth: '2px',
    borderTopWidth: '2px',
    borderBottomWidth: '2px',
  });
  const primary = new FakeElement(['h5p-dq-element', 'focused'], {
    left: 202, top: 102, width: 100, height: 80,
  });
  const secondary = new FakeElement(['h5p-dq-element', 'papijo-secondary-selected'], {
    left: 302, top: 202, width: 40, height: 30,
  });
  const dropZone = new FakeElement(['h5p-dq-dz'], {
    left: 402, top: 72, width: 60, height: 50,
  });
  const params = {
    elements: [
      {x: 20, y: 16.6666666667, width: 10, height: 8},
      {x: 40, y: 50, width: 4, height: 3},
    ],
    dropZones: [{x: 60, y: 6.6666666667, width: 6, height: 5}],
  };
  const primaryDnb = {getElement: () => $(primary)};
  const instance = Object.create(DragQuestion.prototype);

  [primary, secondary].forEach((element, index) => $(element).data('id', index));
  $(dropZone).data('id', 0);
  instance.$editor = $(editor);
  instance.elements = [{$element: $(primary)}, {$element: $(secondary)}];
  instance.dropZones = [{$dropZone: $(dropZone)}];
  instance.params = params;
  instance.secondarySelections = [secondary];
  instance.alignControls = [];
  instance.dnb = {
    dnr: {containerEm: 10},
    focusedElement: primaryDnb,
  };

  return {instance, editor, primary, secondary, dropZone, params, primaryDnb};
}

const modes = [
  ['left', 'left', '20%'],
  ['center', 'left', '26%'],
  ['right', 'left', '32%'],
  ['top', 'top', `${50 / 3}%`],
  ['middle', 'top', '25%'],
  ['bottom', 'top', `${100 / 3}%`],
];

modes.forEach(([mode, property, expected]) => {
  test(`align ${mode} uses rendered outer geometry and preserves the other axis`, () => {
    const {instance, primary, secondary, params} = setup();
    const primaryParams = {...params.elements[0]};
    const unchangedKey = property === 'left' ? 'y' : 'x';
    const unchangedValue = params.elements[1][unchangedKey];

    assert.equal(instance.alignSelection(mode), true);
    assert.equal(secondary.appliedStyles[property], expected);
    assert.equal(Object.hasOwn(secondary.appliedStyles, property === 'left' ? 'top' : 'left'), false);
    assert.equal(params.elements[1][unchangedKey], unchangedValue);
    assert.deepEqual(params.elements[0], primaryParams);
    assert.deepEqual(primary.appliedStyles, {});
  });
});

test('one operation aligns multiple mixed draggable/drop-zone secondaries', () => {
  const {instance, secondary, dropZone, params} = setup();
  instance.secondarySelections.push(dropZone);
  dropZone.classes.add('papijo-secondary-selected');

  assert.equal(instance.alignSelection('center'), true);
  assert.equal(secondary.appliedStyles.left, '26%');
  assert.equal(dropZone.appliedStyles.left, '24%');
  assert.equal(params.elements[1].x, 26);
  assert.equal(params.dropZones[0].x, 24);
});

test('drop-zone primary aligns a draggable secondary', () => {
  const {instance, primary, secondary, dropZone, params} = setup();
  instance.dnb.focusedElement = {getElement: () => $(dropZone)};
  instance.secondarySelections = [secondary];
  dropZone.classes.add('focused');
  primary.classes.delete('focused');

  assert.equal(instance.alignSelection('bottom'), true);
  assert.equal(secondary.appliedStyles.top, `${40 / 3}%`);
  assert.equal(params.elements[1].y, 40 / 3);
  assert.deepEqual(dropZone.appliedStyles, {});
});

test('successful alignment preserves primary focus and secondary state', () => {
  const {instance, primary, secondary, primaryDnb} = setup();

  assert.equal(instance.alignSelection('left'), true);
  assert.equal(instance.dnb.focusedElement, primaryDnb);
  assert.deepEqual(instance.secondarySelections, [secondary]);
  assert.equal(primary.classes.has('focused'), true);
  assert.equal(secondary.classes.has('focused'), false);
  assert.equal(secondary.classes.has('papijo-secondary-selected'), true);
});

test('an invalid complete plan changes no DOM or params', () => {
  const {instance, secondary, dropZone, params} = setup();
  instance.secondarySelections.push(dropZone);
  dropZone.rect.width = 250;
  const original = JSON.parse(JSON.stringify(params));

  assert.equal(instance.alignSelection('right'), false);
  assert.deepEqual(secondary.appliedStyles, {});
  assert.deepEqual(dropZone.appliedStyles, {});
  assert.deepEqual(params, original);
  assert.equal(instance.secondarySelections.length, 2);
});

test('legacy sub-24px secondary can be aligned without resizing', () => {
  const {instance, secondary, params} = setup();
  secondary.rect.width = 20;
  secondary.rect.height = 18;
  params.elements[1].width = 2;
  params.elements[1].height = 1.8;

  assert.equal(instance.alignSelection('left'), true);
  assert.equal(secondary.appliedStyles.left, '20%');
  assert.equal(Object.hasOwn(secondary.appliedStyles, 'width'), false);
  assert.equal(Object.hasOwn(secondary.appliedStyles, 'height'), false);
});

test('Align panel descriptors expose exactly the six intended accessible actions', () => {
  const {instance} = setup();
  const actions = instance.getAlignmentActions();

  assert.equal(actions.map((action) => action.mode).join(','),
    'left,center,right,top,middle,bottom');
  assert.equal(actions.map((action) => action.label).join(','),
    'Align left,Align center,Align right,Align top,Align middle,Align bottom');
});

test('Align control builds one trigger and exactly six panel buttons', () => {
  const {instance} = setup();
  const menuElement = new FakeElement();
  const contextMenu = {
    $contextMenu: $(menuElement),
    on(name, handler) {
      this[name] = handler;
    },
  };
  const dnbElement = {
    contextMenu,
    addButton(name, label) {
      const trigger = new FakeElement([name.toLowerCase()]);
      trigger.attributes['aria-label'] = label;
      menuElement.children.push(trigger);
    },
  };

  instance.addAlignControl(dnbElement);

  const panel = menuElement.children.find((child) => child.classes.has('papijo-align-panel'));
  assert.ok(panel);
  assert.equal(panel.children.length, 6);
  assert.deepEqual(panel.children.map((button) => button.attributes['aria-label']), [
    'Align left', 'Align center', 'Align right',
    'Align top', 'Align middle', 'Align bottom',
  ]);

  panel.hidden = false;
  contextMenu.contextMenuTransform();
  assert.equal(panel.hidden, true);
});

test('Align control appears for the first secondary and disappears with the last', () => {
  const {instance, secondary, primaryDnb} = setup();
  const trigger = new FakeElement();
  const panel = new FakeElement();
  instance.secondarySelections = [];
  instance.alignControls = [{dnbElement: primaryDnb, $trigger: $(trigger), $panel: $(panel)}];

  instance.updateAlignUI();
  assert.equal(trigger.hidden, true);

  instance.addSecondarySelection(secondary);
  assert.equal(trigger.hidden, false);

  panel.hidden = false;
  instance.removeSecondarySelection(secondary);
  assert.equal(trigger.hidden, true);
  assert.equal(panel.hidden, true);
  assert.equal(trigger.attributes['aria-expanded'], 'false');
});

test('blur lifecycle clears selection and closes the Align panel', () => {
  const {instance, editor, secondary, primaryDnb} = setup();
  const trigger = new FakeElement();
  const panel = new FakeElement();
  instance.alignControls = [{dnbElement: primaryDnb, $trigger: $(trigger), $panel: $(panel)}];
  panel.hidden = false;
  instance.dnb.focus = function () {};
  instance.dnb.blurAll = function () {
    this.focusedElement = null;
  };

  instance.initializeMultiSelection();
  instance.secondarySelections = [secondary];
  instance.updateAlignUI();
  instance.dnb.blurAll();

  assert.equal(instance.secondarySelections.length, 0);
  assert.equal(panel.hidden, true);
  assert.equal(trigger.hidden, true);
  assert.equal(editor.classes.has('papijo-has-multi-selection'), false);
});
