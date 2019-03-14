# &lt;mv-sorter&gt;

`mv-sorter` is a custom element that makes the content sortable.

* Handles elements of different sizes

* supports drop of element anywhere on page

* handles changing visibility of drop zones

* optional drag handles

* supports multiple and nested sortable containers

* configurable drop zones per container.

* Dispatches events and uses css classes for changing states

* Respects the disabled attribute

* Allows text selection

* uses movement physics that preserves momentum

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
