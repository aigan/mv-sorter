[![Published on NPM](https://img.shields.io/npm/v/mv-sorter.svg)](https://www.npmjs.com/package/mv-sorter)

# &lt;mv-sorter&gt;

Drag and drop for lists as a web component.

## Demo

See [Demo](https://jonas.liljegren.org/project/mv-sorter/dist/demo/).

## Features

* Natural movement of items using kinetic momentum

* Performant (using requestAnimationFrame and css translate)

* Clean and powerful api

* Vertical lists

* Horizontal lists

* Movement between lists

* Supports both mouse and touch interfaces

* Unopiniated styling

* No creation of additional wrapper dom nodes

* Accepts any html elements as draggable

* Allows text selection around and inside items

* Handles elements of different sizes

* supports drop of element anywhere on page, finding the closest availible drop area

* handles changing visibility of drop zones

* optional drag handles

* supports multiple and nested sortable containers

* configurable drop zones per container.

* Dispatches events and uses css classes for changing states

* Respects the disabled attribute

* Handles changes in element and page layout during dragging and animations


## Usage

### Installation

```
npm install --save mv-sorter
```

### In an html file
```html
<html>
  <head>
    <script type="module">
      import 'mv-sorter/sorter.js';
    </script>
  </head>
  <body>
    <mv-sorter><div>A</div><div>B</div></mv-sorter>
  </body>
</html>
```

### In a Polymer 3 element
```js
import {PolymerElement, html} from '@polymer/polymer';
import 'mv-sorter/mv-sorter.js';

class SampleElement extends PolymerElement {
  static get template() {
    return html`
      <mv-sorter><div>A</div><div>B</div></mv-sorter>
    `;
  }
}
customElements.define('sample-element', SampleElement);
```

## Missing features

* Keyboard and accessability support

* Scroll viewport when items are dragged to edge

## Contributing
If you want to send a PR to this element, here are
the instructions for running the tests and demo locally:

### Installation
```sh
git clone https://github.com/aigan/mv-sorter
cd mv-sorter
npm install
npm install -g polymer-cli
```

### Running the demo locally
```sh
polymer serve --npm
open http://127.0.0.1:<port>/demo/
```

Or you can compile a static version to `dist` for use with a normal
web server: `grunt demo`
