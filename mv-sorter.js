import throttle from "lodash-es/throttle.js";
import debounce from "lodash-es/debounce.js";
import {GestureEventListeners} from "@polymer/polymer/lib/mixins/gesture-event-listeners.js";
import {FlattenedNodesObserver} from "@polymer/polymer/lib/utils/flattened-nodes-observer.js";
import {PolymerElement, html} from "@polymer/polymer/polymer-element.js";
import {setPassiveTouchGestures} from "@polymer/polymer/lib/utils/settings.js";
import {addListener} from "@polymer/polymer/lib/utils/gestures.js";

const log = console.log.bind(console);
setPassiveTouchGestures(true);

class MvSorter extends GestureEventListeners(PolymerElement) {
	
	static get is(){ return 'mv-sorter' }

	static get properties(){ return {
		row: {
			type: Boolean,
			observer: 'dir_changed',
		},
		column: {
			type: Boolean,
			observer: 'dir_changed',
		},
		lock: {
			type: Boolean,
			observer: 'lock_dir_changed',
		},
		group: {
			type: String,
			reflectToAttribute: true,
		},
		draghandle: {
			type: Boolean,
		},
		disabled: {
			type: Boolean,
			reflectToAttribute: true,
		},
	}}

	static get template(){
		return html`
		<style>
		:host {
			display: block;
		}

		main {
			display: flex;
			min-height: 20px;
			min-width: 20px;
		}

		#dropzone {
			pointer-events:none;
			/*margin: 0.5em;*/
			position: absolute;
			outline: 3px dashed hsla(0, 0%, 0%, 0.5);
			outline-offset: -6px;
			height: 100px;
			width: 100px;
			opacity: 0;
			transition: opacity .2s;
		}

		</style>
		<main id="main">
			<slot id="slot"></slot>
		</main>
`;
	}
	
	constructor(){
		super();
		if( !MvSorter._monostate ) MvSorter._monostate = {
			animQueue: new Set(),
			items: new Map(),
			containers: new Set(),
			dirty: new Set(),
			render_jobs: new Map(),
		};

		const mv = this.mv = {}; // put our data here

		const mono = mv.monostate = MvSorter._monostate;
		mono.containers.add( this );

		mv.id = mono.containers.size;
		mv.homes = [];

		this.constructor.throttled_move =
			throttle(this.constructor.throttled_move_handler,500,{trailing:false});

		this.constructor.throttled_anim =
			throttle(this.constructor.throttled_anim_handler,5000,{trailing:false});

		/*
			 100 ms was to short for catching both intersection observer
			 and resize observer.
		 */
		this.constructor.debounced_items_moved =
			debounce(MvSorter.items_moved,200);

		// Import global styles to page
		const style = document.createElement('style');
		style.innerHTML = 'body.mv-moving-child{cursor:move}';
		document.body.appendChild( style );
	}

	connectedCallback(){
    super.connectedCallback();

		const mv = this.mv; // put our data here
		
		new FlattenedNodesObserver(this.$.main,
															 this.nodes_changed.bind(this) );
		mv.debounced_domchange = debounce(this.domchange_handler.bind(this),100);

		this.$.main.addEventListener('dom-change',
																 mv.debounced_domchange.bind(this) );

		const io = new IntersectionObserver( mv.debounced_domchange.bind(this) );
		io.observe( this );
		
		mv.parent_target = null; // update on dom change

		this.dir_changed();
		this.lock_dir_changed();

		this.add_dropzone();
		this.container_rect_changed();
	}

	disconnectedCallback(){
		const mono = this.mv.monostate;
		const items = mono.items;

		//log(`disconnectedCallback ${this.id}`);
		
		// Setting display to none should make offsetParent return null ;
		// which will disable updates during our removal of the children here ;
		this.style.display = 'none';
		
		if( this.mv.parent_target ){
			//log('removing parent', this.mv.parent_target);
			this.mv.parent_target = null;
			const parent = items.get( this.mv.parent_target );
			if( parent ) parent.children_containers.delete( this );
		}

		const children = this.$.slot.assignedNodes();
		for( let target of children.reverse() ){
			this.remove_listeners( target );
		}
		
		super.disconnectedCallback();
	}
	
	// optimized for frequent calls
	container_moved( ev ){
		const mono = this.mv.monostate;
		const items = mono.items;

		//log(`container_moved ${this.id}`);		
		
		// Do not move children to animated parents
		if( this.mv.parent_target ){
			const parent =  items.get(this.mv.parent_target);
			//log(`container ${this.mv.id} has parent ${parent._id}`);
			if( parent.grabbed ) return;
			const at_home = parent.X.pos == parent.X.pos_home && parent.Y.pos == parent.Y.pos_home;
			if( !at_home ) return;
		}
		
		let hurry = false;
		
		mono.dirty.add( this );
		
		const children = this.$.slot.assignedNodes();
		for( let child of children ){
			if( child.nodeType !== Node.ELEMENT_NODE ) continue;
			const item = items.get( child );
			if( !item ) continue; // may not track all elements

			for( let child_cont of item.children_containers ){
				child_cont.container_moved();
			}

			if( item.container === this ) continue;
			mono.dirty.add( item.container );
			hurry = true;
		}

		if( mono.render_jobs.has('items_moved') ){} // on my way
		else if( hurry ){
			//log('hurry', this.mv.id);
			mono.render_jobs.set('items_moved',setTimeout(MvSorter.items_moved));
		}
		else if( mono.dirty.size ){ // soon
			MvSorter.debounced_items_moved();
		}
	}

	static items_moved(){
		const mono = MvSorter._monostate;
		mono.render_jobs.delete('items_moved');
		
		for( let container of mono.dirty ){
			//log(`items_moved in ${container.mv.id} ${container.id}`);
			container.container_rect_changed();
		}

		for( let container of mono.dirty ){
			mono.dirty.delete( container );
			container.render_items();
		}
	}

	render_items(){
		const container = this;
		const mv = container.mv;
		const mono = mv.monostate;
		const items = mono.items;
		
		// Skip if container not currently visible
		if( !this.offsetParent ) return;

		const ax = this.axisAB();
		
		let oA = mv[ax.A].a + mv[ax.A].p1;
		let oB = mv[ax.B].a + mv[ax.B].p1;

		//log(`${this.mv.id} render_items at (${oA},${oB})`);
		
		for( let target of mv.homes ){

			if( !target.parentElement ) continue; // recently removed

			const item = items.get( target );

			const A = item[ax.A];
			const B = item[ax.B];
			const X = item.X;
			const Y = item.Y;
			const at_home = A.pos == A.pos_home && B.pos == B.pos_home;

			container.item_rect_changed( target );
			
			oA += A.m1;

			A.pos_home = Math.round(oA - item[ax.A].offset);
			B.pos_home = Math.round(oB + B.m1 - item[ax.B].offset);

			//log(`render ${target.id} ${container.mv.id}.${item.idx} : (${Math.round(X.pos)},${Math.round(Y.pos)}) -> (${X.pos_home},${Y.pos_home})`);

			if( item.grabbed ){}
			else if( at_home ){
				A.pos = A.pos_end = A.pos_home;
				B.pos = B.pos_end = B.pos_home;
			} else {
				item.container.find_dropzone( target );
				// anim both since we check pos in animScaleCrash 
				for( let axis of ['X','Y'] ){
					item[axis].pos_end = item[axis].pos_home;
					MvSorter.addAnim('pos'+axis, MvSorter.animPosFall(target,axis), target);
				}
			}

			const translate = `translate(${X.pos}px, ${Y.pos}px) `;
			target.style.transform = translate;
			//log( translate );
			
			//target.style.visibility = 'visible'; // TEST

			oA += A.size + A.m2;
		}
	}

	add_item( target ){
		const container = this;
		const mv = container.mv;
		const mono = mv.monostate;
		const items = mono.items;
		
		if( mv.homes.length < 2 ) return;
		
		const ax = this.axisAB();
		
		const last = mv.homes[ mv.homes.length - 2 ];
		const l_item = items.get(last);

		const item = items.get(target);

		const A = item[ax.A];
		const B = item[ax.B];

		const gA = l_item[ax.A].offset + l_item[ax.A].pos_home;
		const oA = gA + l_item[ax.A].size + l_item[ax.A].m2 + A.m1;

		const gB = l_item[ax.B].offset + l_item[ax.B].pos_home;
		const oB = gB - l_item[ax.B].m1 + B.m1;

		A.pos = A.pos_end = A.pos_home = Math.round(oA - A.offset);
		B.pos = B.pos_end = B.pos_home = Math.round(oB - B.offset);

		const X = item.X;
		const Y = item.Y;

		//log(`${container.mv.id} ${container.id} add_item ${target.id} (${X.pos},${Y.pos})`);
		
		const translate = `translate(${X.pos}px, ${Y.pos}px) `;
		target.style.transform = translate;
	}

	dir_changed(){
		let dir = 'row';
		if( this.column ) dir = 'column';
		if( this.row ) dir = 'row';
		this.direction = dir;

		//log(`dir_changed to ${dir}`);
		this.$.main.style['flex-direction'] = dir;
	}

	lock_dir_changed(){
		//log(`lock_dir_changed to ${this.lock} ${this.direction}`);
		if( this.lock && this.direction == 'row' ){
			this.mv.axes = ['X'];
		} else if( this.lock && this.direction == 'column' ){
			this.mv.axes = ['Y'];
		} else {
			this.mv.axes = ['X','Y'];
		}
	}

	axisAB(){
		if( this.direction == 'row' ){
			return {
				A: 'X',
				B: 'Y',
			};
		} else {
			return {
				A: 'Y',
				B: 'X',
			};
		}
	}

	static axisB( axis ){
		return axis == 'X' ? 'Y' : 'X';
	}
	
	nodes_changed( mutations ){
		//log(this.mv.id, 'nodes_changed', mutations);
		for( let added of mutations.addedNodes ){
			this.add_listeners( added );
		}

		for( let removed of mutations.removedNodes ){
			this.remove_listeners( removed );
		}

		this.mv.debounced_domchange.call(this);
	}

	add_listeners( target ){
		if( target.nodeType !== Node.ELEMENT_NODE ) return;
		if( target.id == 'dropzone' ) return;
		if( !target.offsetParent ) return; // element hidden

		const mono = this.mv.monostate;
		
		const desig = target.id || target.innerText || target.nodeName;
		//log(`add_listeners for ${this.mv.id} item ${desig}`);

		// track state end and up events do not always trigger! There is
		// a bug in gesture-event-listeners

		addListener(target, 'tap', this.tap_handler.bind(this));
		addListener(target, 'track', this.track_handler.bind(this));

		addListener(target, 'down', this.down_handler.bind(this));
		addListener(target, 'up', this.up_handler.bind(this));

		const X = {
			scale: 1,         // multiplier for transform
			pos: 0,           // relative its static position
			pos_end: 0,       // current target of movement
			pos_home: 0,      // resting place
			pos_speed: 0,     // pixels per frame
			offset: 0,        // relative page
			offset_handle: 0, // relative target
			t_origin: 0,      // transform origin
			size: 0,          // size excluding margins
			mid_handle: 0,    // half the size of the handle
			m_size: 0,        // size including margins
			m1: 0,            // first margin
			m2: 0,            // second margin
			rotate: 0,        // in radians
			turned: false,    // used by animPosFall
			crashed: false,   // used by animScaleCrash
		};

		const Y = Object.assign({}, X);
		const idx = this.mv.homes.length; // next idx
		
		// Polymer dom-repeat reuses elements. Do not assume that the
		// logical identity of the item goes unchanged. No id stuff here.
			
			const item = {
				X, Y,
				grabbed: false,
				throwed: false,
				animQueue: new Map(),
				children_containers: new Set(),
				idx: idx,
				container: this,
				get _id(){ return MvSorter.desig(target) },
			};

		this.mv.homes[idx] = target;
		mono.items.set( target, item );
		//log('added to items', target);
		

		this.item_rect_changed( target );
		this.add_item( target );

		item.resize_observer = new ResizeObserver(this.container_moved.bind(this));
		item.resize_observer.observe( target );
	}

	item_rect_changed( target ){
		/* Keep last known value if target is not currently visible. */
		if( !target.offsetParent ) return;

		const item = this.mv.monostate.items.get( target );
		const X = item.X;
		const Y = item.Y;
		
		const transform = target.style.transform;
		target.style.transform = "";
		const rect = target.getBoundingClientRect(); // original dimentions
		target.style.transform = transform;

		//log( item._id, rect );

		X.pos_mid = rect.width / 2;
		Y.pos_mid = rect.height / 2;

		// Excluding margins
		X.size = rect.width;
		Y.size = rect.height;

		const X_prev = X.offset;
		const Y_prev = Y.offset;
		
		const X_new = window.scrollX + rect.left;
		const Y_new = window.scrollY + rect.top;

		const c = getComputedStyle( target );
		
		X.m1 = parseFloat(c.marginLeft);
		X.m2 = parseFloat(c.marginRight);
		Y.m1 = parseFloat(c.marginTop);
		Y.m2 = parseFloat(c.marginBottom);

		X.m_size = X.m1 + X.size + X.m2;
		Y.m_size = Y.m1 + Y.size + Y.m2;

		// rounding values will move some items 1px
		X.offset = X_new;
		Y.offset = Y_new;

		// for DEBUG
		if( false ){ // X_prev !== X.offset || Y_prev !== Y.offset ){
			log(`${this.id} ${MvSorter.desig(target)} (${Math.round(X_prev)},${Math.round(Y_prev)})-> (${Math.round(X_new)},${Math.round(Y_new)}) `);
		}

		this.handle_rect_changed( target );

		X.t_origin = X.pos + X.offset_handle + X.mid_handle;
		Y.t_origin = Y.pos + Y.offset_handle + Y.mid_handle;
		
		//log( item );
	}

	handle_rect_changed( target ){
		const mono = this.mv.monostate;
		const items = mono.items;
		const item = items.get( target );
		if( !item ) return;

		const handle = item.handle;
		if( !handle ) return;

		if( handle == target ){
			item.X.offset_handle = 0;
			item.Y.offset_handle = 0;
			item.X.mid_handle = item.X.size / 2;
			item.Y.mid_handle = item.Y.size / 2;
			return;
		}

		if( !handle.offsetParent ) return;

		//log('offset_handle update');

		const rect = handle.getBoundingClientRect();

		item.X.offset_handle = rect.x + window.scrollX - item.X.offset - item.X.pos;
		item.Y.offset_handle = rect.y + window.scrollY - item.Y.offset - item.Y.pos;

		//log('Y', rect.y, window.scrollY, item.Y.offset );

		item.X.mid_handle = rect.width / 2;
		item.Y.mid_handle = rect.height / 2;
	}

	remove_listeners( node ){
		const mono = this.mv.monostate;
		const items = mono.items;
		const item = items.get( node );

		if( !item ) return;

		//log('remove_listeners disabled'); return;
		
		Polymer.Gestures.removeListener(node, 'tap', this.tap_handler);
		Polymer.Gestures.removeListener(node, 'track', this.track_handler);
		Polymer.Gestures.removeListener(node, 'down', this.down_handler);
		Polymer.Gestures.removeListener(node, 'up', this.up_handler);

		const container = item.container;
		mono.dirty.add( container );
		
		if( !Number.isInteger( item.idx ) ){
			//log(`${item._id} was removed from ${container.id}`);
		}
		else {
			//log(`Removed ${item._id} ${container.id}.${item.idx}`);
			container.mv.homes.splice( item.idx, 1 );
			container.reindex();
		}

		for( let child_cont of item.children_containers ){
			child_cont.mv.parent_target = null;
		}
		item.children_containers.clear();
		
		items.delete( node );
		
		//log( 'Removal', this.mv.id, node );
		MvSorter.debounced_items_moved();
	}

	item_drag_start( target, ev ){
		const mono = this.mv.monostate;
		const item = mono.items.get( target );
		if( item.grabbed ) return; // already grabbed?

		if( this.disabled ) return;
		
		//log('item_drag_start', target.id);

		/* ev.path might not be standard. Maby use ev.composedPath() */
		if( this.draghandle && ev.path ){
			for( let el of ev.path ){
				if( el.tagName == 'MV-DRAGHANDLE' ){
					item.grabbed = true;
					item.handle = el;
					break;
				}
				if( el.tagName == 'MV-SORTER' ) break;
			}
		} else {
			item.grabbed = true;
			item.handle = target;
		}

		if( !item.grabbed ) return; // exit if not grabbed
		
		/* TODO: Only do handle_rect_changed when needed */
		this.item_rect_changed( target );

		item.throwed = false;


		// Calculate scale for hovering
		const size = Math.max( item.X.size, item.Y.size );
		const add = 0.01 * size + 5;
		const scale = ( size + add ) / size;
		
		MvSorter.addAnim('scale', MvSorter.animScale(target, scale, 200), target);
		target.classList.add('moved');
		this.classList.add('moving-child');
		document.body.classList.add('mv-moving-child');
		
		this.$.main.style['user-select'] = 'none';
		if( window.getSelection ) window.getSelection().removeAllRanges();

		if( this.mv.parent_target ){
			//log('z-index', 2, this.mv.parent_target.id);
			this.mv.parent_target.style['z-index'] = 2;
		}
		
		for( let axis of this.mv.axes ){
			const A = item[axis];
			A.turned = false;
			A.crashed = false;
			A.pos_start = A.pos; // Only defined if axis used
			MvSorter.addAnim('pos'+axis, MvSorter.animPosDrag(target,axis), target);
		}

	}

	item_drag_end( target ){
		const item = this.mv.monostate.items.get( target );
		if( !item.grabbed ) return;

		//log(`item_drag_end ${target.id} (${item.X.pos_end},${item.Y.pos_end}) --> (${item.X.pos_home},${item.Y.pos_home}) `);

		item.throwed = true;
		item.grabbed = false;
		
		this.classList.remove('moving-child');
		document.body.classList.remove('mv-moving-child');

		this.$.main.style['user-select'] = '';

		if( this.mv.parent_target ){
			//log('z-index', 1, this.mv.parent_target.id);
			this.mv.parent_target.style['z-index'] = 1;
		}
		
		for( let axis of this.mv.axes ){
			const axB = MvSorter.axisB(axis);
			item[axis].pos_end = item[axis].pos_home;
			MvSorter.addAnim('pos'+axis, MvSorter.animPosFall(target,axis), target);
			MvSorter.addAnim('rotate'+axB, MvSorter.animRotateRecover(target,axB), target);
		}
	}

	static item_moved( target ){
		const mono = MvSorter._monostate;
		const item = mono.items.get(target);
		
		//log(`item_moved ${item._id}`);

		/* Moved away from original home? */
		if( !item.X.pos_home && !item.Y.pos_home ) return;

		const cont = item.container;

		const orig = cont.element_origin( target );

		const init = {
			detail: { element: target, item: item, },
			composed: true,
			bubbles: true,
		};
		
		if( cont !== orig ){
			//log(`Item ${item._id} moved to other container`);
			orig.dispatchEvent(new CustomEvent('dropoutside', init ));
		} else {	
			//log(`Item ${item._id} moved`);
		}

		cont.dispatchEvent(new CustomEvent('drop', init ));
	}

	reindex(){
		//log(`reindex ${this.id}`);

		const mono = this.mv.monostate;
		const items = mono.items;
		const homes = this.mv.homes;
		const length = homes.length;

		for( let idx=0; idx < length; idx++ ){
			const target = homes[idx];
			const item = items.get( target );
			if( !item ) continue;
			item.idx = idx;
			//log(`${item.idx} -> ${idx}`);
		}

		return length;
	}


	domchange_handler(){
		//log(`domchange_handler ${this.mv.id} ${this.id}`);

		// parent might not exist on creation. Check for availability now
		const parent = this.offsetParent;
		if( parent ){
			if( !this.resize_observer ){
				this.resize_observer = new ResizeObserver(this.container_moved.bind(this));
				this.resize_observer.observe( parent );
			}
			
			// Discover current parent container
			this.container_update_parent();

			// Handle visibility changes of elements
			const mono = this.mv.monostate;
			const items = mono.items;
			const children = this.$.slot.assignedNodes();
			for( let child of children ){
				if( child.nodeType !== Node.ELEMENT_NODE ) continue;
				const item = items.get( child );
				if( item ){
					// TODO: Might want to remove hidden items. But only if
					// container is visible but child is not. But we might want to
					// keep items moved to currently hidden containers.
				} else {
					this.add_listeners( child );
				}
			}
		}
		
		// React to possible layout changes
		this.container_moved(); // Place new items
	}

	container_rect_changed(){
		//log(`container_rect_Changed ${this.mv.id} ${this.id}`);
		// If recently hidden, keep last known position
		if( !this.offsetParent ) return;

		const mv = this.mv;
		
		const rect = this.$.main.getBoundingClientRect();
		const sX = window.scrollX;
		const sY = window.scrollY;

		// Get container padding
		const c = getComputedStyle( this );		
		
		mv.X = {
			a: rect.left + sX,
			b: rect.right + sX,
			mid: rect.left + sX + ( rect.width / 2 ),
			p1: parseFloat( c.paddingLeft ),
			p2: parseFloat( c.paddingRight ),
		};
		
		mv.Y = {
			a: rect.top + sY,
			b: rect.bottom + sY,
			mid: rect.top + sY + ( rect.height / 2 ),
			p1: parseFloat( c.paddingTop ),
			p2: parseFloat( c.paddingBottom ),
		};

		const zone = mv.zone;
		this.item_rect_changed( zone );
		
		//log(`Container ${this.mv.id} ${this.id} (${this.X.a},${this.Y.a}) w ${rect.width} h ${rect.height} ${this.direction}`);
	}

	container_update_parent(){
		const mono = this.mv.monostate;
		const items = mono.items;
		const cont = this;

		//log('container_update_parent', cont.id);
		const parent_target = find_parent( cont, cont );
		
		const prev = this.mv.parent_target;
		if( parent_target ){
			//log('container_update_parent', cont.id, '-->', parent_item._id);
			if( prev == parent_target ) return; // no change

			this.mv.parent_target = parent_target;
			items.get(parent_target).children_containers.add( this );
		}

		if( prev ) prev.children_containers.delete( this ); // unless no change		
		
		
		function find_parent( el ){
			const parent = el.parentNode || el.host;
			if( !parent ){
				//log('no parent');
				return null;
			}

			//log('check', parent);
			const item = items.get( parent );
			if( item ) return parent;
			
			return find_parent( parent );
		}
	}
	
	/*
	 * Commits all items in current container, affecting other
	 * containers if items in this container has been moved to/from other
	 * container.
	 */
	commit(){
		
	}

	/**
	 * Returns an array of elements currently placed in this container.
	 */
	elements(){
		return this.mv.homes.slice(0);
	}

	/*
	 * Returns an array of elements moved from this container.
	 */
	elements_removed(){
		const mono = this.mv.monostate;
		const items = mono.items;

		const list = [];

		const children = this.$.slot.assignedNodes();
		for( let child of children ){
			if( child.nodeType !== Node.ELEMENT_NODE ) continue;
			const item = items.get( child );
			if( !item ) continue; // may not track all elements

			if( item.container === this ) continue;

			list.push( child );
		}

		return list;
	}

	/**
	 * Returns the original container this element belongs to, before
	 * reordering.
	 */
	element_origin( target ){
		const mono = this.mv.monostate;
		const items = mono.items;
		const item = items.get( target );

		if( !item ) return null;
		return target.parentElement;
	}

	/**
	 * Returns the current container this element belongs to,
	 *	acknowledging reordering.
	 */
	element_home( target ){
		const mono = this.mv.monostate;
		const items = mono.items;
		const item = items.get( target );

		if( !item ) return null;
		return item.container;
	}

	/**
	 * Restores the containers items to the default position,
	 * returning and giving back elements from other containers.
	 */
	reset(){
		const seen = new Set();
		const mono = this.mv.monostate;
		const items = mono.items;

		const homes_new = [];
		const children = this.$.slot.assignedNodes();
		for( let target of children ){
			if( seen.has( target ) ) continue;
			seen.add( target );

			const item = items.get( target );
			// TODO: re-evaluate element for tracking
			if( !item ) continue; // may not track all elements
			
			const old_container = item.container;
			const old_idx = item.idx;
			
			mono.dirty.add( old_container );

			const idx = homes_new.length; // next idx
			item.idx = idx;
			item.container = this; // FIXME: move things in old container
			homes_new[ idx ] = target;

			if( old_container !== this ){
				//log(`deleting ${old_container.id}.${old_idx}`);
				old_container.mv.homes.splice( old_idx, 1 );
				old_container.reindex();
			}
			
			const desig = target.id || target.innerText || target.nodeName;
			//log(`${desig} ${old_container.id}.${old_idx} -> ${this.id}.${idx}`);
		}

		for( let target of this.mv.homes ){
			if( seen.has( target ) ) continue;
			seen.add( target );

			const item = items.get( target );
			// TODO: re-evaluate element for tracking
			if( !item ) continue; // may not track all elements

			const desig = target.id || target.innerText || target.nodeName;
			const orig_container = target.parentElement;

			const old_container = item.container; // should always be 'this'
			const old_idx = item.idx;

			if( !orig_container ){
				// target could have been recently removed
				//log(`${desig} ${old_container.id}.${old_idx} -> removed`);
				old_container.mv.homes.splice( old_idx, 1 );
				// no need to reindex. homes_new set after this
				item.idx = null;
				continue;
			}
			
			mono.dirty.add( orig_container );
			
			const idx = orig_container.mv.homes.length;
			item.idx = idx;
			item.container = orig_container;
			orig_container.mv.homes[ idx ] = target;

			//log(`${desig} ${old_container.id}.${old_idx} -> ${orig_container.id}.${idx}`);
		}

		this.mv.homes = homes_new;

		MvSorter.items_moved();
	}


	add_dropzone(){
		const mv = this.mv;
		const mono = mv.monostate;
		if( mv.zone ) return;

		const X = {
			scale: 1,       // multiplier for transform
			pos: 0,         // relative its static position
			pos_end: 0,     // current target of movement
			pos_home: 0,    // resting place
			offset: 0,      // relative page
			size: 0,        // size excluding margins
			m_size: 0,      // size including margins
			m1: 0,          // first margin
			m2: 0,          // second margin
			rotate: 0,      // in radians
			t_origin: 0,    // not used
		};

		const Y = Object.assign({}, X);

		const zoneD = {
			X, Y,
			animQueue: new Map(),
			//container_orig: this,
			container: this,
		};

		const zone = document.createElement('div');
		zone.id = 'dropzone';
		this.shadowRoot.insertBefore(zone,this.$.main);
		//log(zone.offsetLeft, zone.offsetTop );
		mv.zone = zone;
		mono.items.set( zone, zoneD );
		
		
		//const el = this.$.dropzone;
		//this.dz_offsetLeft = el.offsetLeft;
		//this.dz_offsetTop = el.offsetTop;
	}

	tap_handler( ev ){
		// log('tap');
	}

	track_handler( ev ){
		if( this.disabled ) return;
		ev.stopPropagation();
		const track = ev.detail;
		const target = ev.currentTarget;
		if( track.state == 'track' ) return this.track_move(  track, target );
		if( track.state == 'start' ) return this.item_drag_start( target, ev );
		if( track.state == 'end'   ) return this.item_drag_end( target );
	}

	down_handler( ev ){
		ev.stopPropagation();
		this.item_drag_start( ev.currentTarget, ev );
	}

	up_handler( ev ){ // Not always triggerd! Bug in gesture-event-listeners.
		ev.stopPropagation();
		this.item_drag_end( ev.currentTarget );
	}

	track_move( track, target ){
		const item = this.mv.monostate.items.get( target );
		if( !item.grabbed ) return;

		if( typeof item.X.pos_start !== 'undefined' ){
			item.X.pos_end = track.x
										 + window.scrollX
										 - item.X.offset
										 - item.X.offset_handle
										 - item.X.mid_handle;
		}

		if( typeof item.Y.pos_start !== 'undefined' ){
			item.Y.pos_end = track.y
										 + window.scrollY
										 - item.Y.offset
										 - item.Y.offset_handle
										 - item.Y.mid_handle;
		}

		//log(`(${item.X.pos_end},${item.Y.pos_end}})`);
		//MvSorter.throttled_move(track, target); // for DEBUG
	}

	static throttled_move_handler( track, target ){
		const item = MvSorter._monostate.items.get( target );
		const X = item.X;
		const Y = item.Y;
		log(`move ${target.id} track+scroll (${Math.round(track.x + window.scrollX)},${Math.round(track.y + window.scrollY)}) target offset (${Math.round(X.offset)},${Math.round(Y.offset)}) handle offset (${Math.round(X.offset_handle)},${Math.round(Y.offset_handle)})`);
		//log(`move ${target.id} (${Math.round(X.pos+X.offset+X.size/2)},${Math.round(Y.pos+Y.offset+Y.size/2)}) (${Math.round(X.t_origin+X.offset)},${Math.round(Y.t_origin+Y.offset)})`);
	}

	find_container( target ){
		const mono = this.mv.monostate;
		const items = mono.items;
		const item = items.get( target );
		const group = target.parentElement.group;

		const grace = 10; // For edge cases
		
		// Only drop in same container if no container group specified
		if( !group ) return this;

		const midG = {};

		for( let axis of ['X','Y'] ){
			midG[axis] = Math.floor( item[axis].pos
														 + item[axis].pos_mid
														 + item[axis].offset );
		}

		//log(`find_dropzone for ${target.parentElement.id} ${MvSorter.desig(target)} (${midG.X},${midG.Y}) ()`);

		
		let closest = Infinity;
		const cc = new Set(); // closest container
		//const dists = []; // DEBUG
		
		for( let container of mono.containers ){
			
			//log('check', container.id);

			// Check if container is currently visible
			if( !container.offsetParent ) continue;

			// Check that the target is allowed in container
			if( ! container.allows_target( target ) ) continue;
			
			let dist = Infinity;
			const X = container.mv.X;
			const Y = container.mv.Y;

			//log(`Locating ${container.mv.id} ${container.id} at (${X.a},${Y.a}),(${X.b},${Y.b})`);
			
			let dir; // DEBUG: direction
			
			if( X.a > midG.X )
				{
					if( Y.a > midG.Y )
						{
							dir = 'SE';
							const dX = X.a - midG.X;
							const dY = Y.a - midG.Y;
							dist = Math.sqrt( dX*dX + dY*dY );
						}
					else if( Y.b < midG.Y )
						{
							dir = 'NE';
							const dX = X.a - midG.X;
							const dY = midG.Y - Y.b;
							dist = Math.sqrt( dX*dX + dY*dY );
						}
					else
						{
							dir = 'E';
							dist = X.a - midG.X;
						}
				}
			else if( X.b < midG.X )
				{
					if( Y.a > midG.Y )
						{
							dir = 'SW';
							const dX = midG.X - X.b;
							const dY = Y.a - midG.Y;
							dist = Math.sqrt( dX*dX + dY*dY );
						}
					else if( Y.b < midG.Y )
						{
							dir = 'NW';
							const dX = midG.X - X.b;
							const dY = midG.Y - Y.b;
							dist = Math.sqrt( dX*dX + dY*dY );
						}
					else
						{
							dir = 'W';
							dist = midG.X - X.b;
						}
				}
			else if( Y.a > midG.Y )
				{
					dir = 'S';
					dist = Y.a - midG.Y;
				}
			else if( Y.b < midG.Y )
				{
					dir = 'N';
					dist = midG.Y - Y.b;
				}
			else
				{
					dir = 'C';
					dist = 0;
				}
			
			//dists[container.mv.id] = `${dir} ${dist}`;
			//log(`Item ${target.id} -> ${container.mv.id} ${dir} ${dist}`);
			
			if( dist < closest ){
				closest = dist;
				cc.clear();
			}

			if( dist <= closest + grace ) cc.add( container );

			//log('dist', container.id, dist);
		}

		// Considering nested containers
		let deepest = 0;
		let found = null;
		for( let c of cc ){
			const depth = c.nesting_depth();
			if( depth >= deepest ){
				found = c;
				deepest = depth;
			}
			//log('depth', c.id, depth );
		}
		
		return found;
	}

	find_dropzone( target ){
		const mono = this.mv.monostate;
		const items = mono.items;
		const item = items.get( target );

		const cc = this.find_container( target );
		const mv = cc.mv;

		//log(`Item ${target.id} -> ${cc.id}`);
		//log(`Item ${target.id}`, dists, cc.id);
		//log( item );


		const mid = {};
		for( let axis of ['X','Y'] ){
			mid[axis] = item[axis].pos + item[axis].pos_mid + item[axis].offset;
		}


		
		let midH, idxH;
		const children = cc.mv.homes;
		let slot_count = children.length + 1;
		
		const ax = cc.axisAB();
		const axA = ax.A;
		const midA = mid[axA];
		
		if( item.container === cc ){

			idxH = item.idx;
			midH = item[axA].pos_home + item[axA].pos_mid + item[axA].offset;
			
		} else {
			
			idxH = 0;
			midH = -1;
			
		}

		
		// Can't compare with current position if elements are of
		// different sizes. That would cause "wobbling"
		//log('item', midH, 'at', mid[axA], 'slots', slot_count);
		//log(`${item._id} with home ${midH} now at ${mid[axA]}`);
		
		let idx;
		if( midA < midH ){
			let oA = midH + item[axA].pos_mid;
			for( let i=idxH; i>=0; i-- ){
				//const child_item = items.get( children[i] );
				//const ci_width = child_item ? child_item.width : item.width;

				const ci = items.get( children[i] );
				const ci_size = ci ? ci[axA].m_size : item[axA].m_size;
				
				let size = ci_size;
				if( item[axA].m_size < size ) size = item[axA].m_size;
				//log(`${i} ${ci ? ci._id : 'dropzone'} Before ${oA} + ${size}`);
				oA -= ci_size;
				if( midA < oA + size ){
					idx = i;
				} else break;
			}
		} else if( midA > midH ){
			idx = 0;

			//let oX = cc.mv.X.offset;
			let oA = mv[axA].a + mv[axA].p1;; //add first margin?
			
			for( let i=0; i < slot_count; i++ ){
				// TODO: FIXME:  add first margin left?

				//const child_item = items.get( children[i] );
				//const ci_width = child_item ? child_item.width : item.width;

				const ci = items.get( children[i] );
				const ci_size = ci ? ci[axA].m_size : item[axA].m_size; 

				let size = ci_size;
				if( item[axA].m_size < size ) size = item[axA].m_size;
				//log(`${i} ${ci ? ci._id : 'dropzone'} After ${oA} - ${size}`);
				oA += ci_size;
				if( midA > oA - size ){
					idx = i;
				} else break;
				
			}
		}

		if( idx !== undefined ) cc.assign_dropzone( target, idx );
	}

	assign_dropzone( s_target, idxIn ){
		const mv = this.mv;
		const mono = mv.monostate;
		const items = mono.items;
		const zone = mv.zone;
		const zoneD = items.get( zone );

		//log(`Item ${s_target.parentElement.id} ${MvSorter.desig(s_target)} -> ${this.id}.${idxIn}`);

		//## _prev not usable since we have multiple ongoing things
		const zone_idx_prev = zoneD.idx;
		const zone_cont_prev = zoneD.container;
		
		// starting values, before reassignment
		const zone_idx = zoneD.idx = idxIn;
		const zone_cont = zoneD.container = this; // TODO: use the containers zone

		const s_item = items.get( s_target );

		s_item.container.mv.zone.style.opacity = 0;
		zone.style.opacity = 1;
		
		//if( (s_item.container !== zone_cont) || (s_item.idx !== zone_idx ) ){
		//	log(`setZone ${s_target.id} ${s_item.container.mv.id}.${s_item.idx} -> ${zone_cont.mv.id}.${zone_idx}`);
		//}
		
		const containers = mono.containers;
		let container, oA, oB, homesNew, idx;


		// TODO: pass in data instead of using scoped varables
		function setZone(){
			const ax = container.axisAB();
			s_item.idx = idx;
			homesNew[idx] = s_target;
			s_item.container = container; // TODO: CHECKME

			oA += s_item[ax.A].m1;
			
			s_item[ax.A].pos_home = Math.round(oA - s_item[ax.A].offset);
			s_item[ax.B].pos_home = Math.round(oB + s_item[ax.B].m1 - s_item[ax.B].offset);

			//log(`setZone ${MvSorter.desig(s_target)} ${s_item.container.id}.${s_item.idx} (${s_item.X.pos_home},${s_item.Y.pos_home})`);
			//log( s_item, s_item.X.offset, s_item.Y.offset );
			
			const dz_style = zone.style;
			dz_style.width = s_item.X.size + 'px';
			dz_style.height = s_item.Y.size + 'px';
			const offset = {};
			offset[ax.A] = oA - zoneD[ax.A].offset;
			offset[ax.B] = oB + s_item[ax.B].m1 - zoneD[ax.B].offset;
			dz_style.transform = `translate(${offset.X}px,${offset.Y}px) `;
			
			oA += s_item[ax.A].size + s_item[ax.A].m2;
			idx ++;					
		}
		
		for( container of containers ){
			if( !container.offsetParent ) continue; // currently hidden
			
			const mv = container.mv;
			const ax = container.axisAB();
			idx = 0;
			homesNew = [];
			oA = mv[ax.A].a + mv[ax.A].p1;
			oB = mv[ax.B].a + mv[ax.B].p1;

			//log(`${container.id} (${oA},${oB})`);
			
			for( let target of mv.homes ){
				//if( !target ) log( mv.homes ); // DEBUG

				if( zone_idx == idx && zone_cont == container ) setZone();
				const item = items.get( target );

				const X = item.X;
				const Y = item.Y;
				const A = item[ax.A];
				const B = item[ax.B];
				
				if( target == s_target ){
					//log(`Skipping ${target.id} ${item.container.mv.id}.${item.idx} (${X.pos_home},${Y.pos_home})`);
					//log( zone_idx, idx, zone_cont.id, container.id );
					continue;
				}
				
				item.idx = idx;
				homesNew[idx] = target;
				//item.container = container; // TODO: CHECKME

				oA += A.m1;

				A.pos_home = Math.round(oA - A.offset);
				B.pos_home = Math.round(oB + B.m1 - B.offset);

				const desig = target.id || target.innerText;
				//log(`${desig} ${container.mv.id}.${idx} : (${X.pos_end},${Y.pos_end}) -> (${X.pos_home},${Y.pos_home})`);

				if( !item.grabbed ){
					if( X.pos_end !== X.pos_home ){
						X.pos_end = X.pos_home;
						MvSorter.addAnim('posX', MvSorter.animPosFall(target,'X'), target);
					}
					
					if( Y.pos_end !== Y.pos_home ){
						Y.pos_end = Y.pos_home;
						MvSorter.addAnim('posY', MvSorter.animPosFall(target,'Y'), target);
					}
				}

				oA += A.size + A.m2;
				idx ++;
			}

			if( zone_idx >= homesNew.length  && zone_cont == container ) setZone();
			
			mv.homes = homesNew;
			//log( homesNew );
		}

	}
	
	allows_target( target ){
		// Might be extended to consider the current situation for each item;

		//log('allows_target', this.id, MvSorter.desig(target));
		
		// Defaults to only check for matching group;
		if( this.group !== target.parentElement.group ) return false;

		// Sanity check for not dropping element inside itself;
		if( this.has_parent( target ) ) return false;

		//log('allows_target', 'yes');
		
		return true;
	}

	has_parent( target ){
		const parent = this.mv.parent_target;
		if( !parent ) return false;

		if( parent == target ) return true;

		const item = this.mv.monostate.items.get( parent );
		if( !item ) return false;
		
		return item.container.has_parent( target );
	}

	nesting_depth( depth){
		if( !depth ) depth = 0;
		const parent = this.mv.parent_target;
		if( !parent ) return depth;

		const item = this.mv.monostate.items.get( parent );
		if( !item ) return depth;

		return item.container.nesting_depth( depth + 1 );
	}
	
	static addAnim( slot, fn, target ){
		//console.warn(`${target.id} addAnim ${slot}`);
		const mono = MvSorter._monostate;
		const item = mono.items.get( target );
		item.animQueue.set( slot, fn );
		
		mono.animQueue.add( target );
		if( !mono.animLoop ) MvSorter.startAnim();
	}

	static startAnim(){
		//log("Starting anim");
		const mono = MvSorter._monostate;
		
		const perspective = "perspective(500px) ";

		let lastFrame = performance.now();
		mono.animLoop = function( now ){
			//log('drawing');
			const delta = now - lastFrame;
			for( let target of mono.animQueue.values() ){
				const item = mono.items.get(target);
				if( !item ){
					mono.animQueue.delete(target);
					continue;
				}
				
				for( let [slot, fn] of item.animQueue ){
					//log(`Anim ${target.id} ${slot}`);
					if( !fn(now,delta ) ) item.animQueue.delete(slot);
				}

				const translate = `translate(${item.X.pos}px, ${item.Y.pos}px) `;
				const scale = `scale(${item.X.scale},${item.Y.scale}) `;
				const rotate = `rotateX(${item.X.rotate}rad) rotateY(${item.Y.rotate}rad) `;
				//log( translate );
				target.style['transform-origin'] = `${item.X.t_origin}px ${item.Y.t_origin}px`;
				target.style.transform = scale + perspective + rotate + translate;

				//log( target.style['transform-origin'] );
				
				if(!item.animQueue.size ) mono.animQueue.delete(target);
			}
			lastFrame = now;
			if(!mono.animQueue.size ) MvSorter.stopAnim();
			else requestAnimationFrame( mono.animLoop );

			//MvSorter.throttled_anim(); // for DEBUG
		}
		mono.animLoop( lastFrame );
	}

	static stopAnim(){
		//log("Stopping anim");

		// Only when all animations finished
		const mono = MvSorter._monostate;
		delete mono.animLoop;

		for( let container of mono.containers ){
			const zone = container.mv.zone;
			if( zone ){
				zone.style.opacity = 0;
			}
		}
	}

	static throttled_anim_handler(){
		log(`animation running`);
		const mono = MvSorter._monostate;
		for( let target of mono.animQueue.values() ){
			const item = mono.items.get(target);
			if( !item ){
				mono.animQueue.delete(target);
				continue;
			}
			
			for( let slot of item.animQueue.keys() ){
				log(` * ${item.container.mv.id} ${target.id} ${slot}`);
			}
		}
		//log( mono.animQueue );
	}

	static animScale( target, scale_end, duration ){
		const mono = MvSorter._monostate;
		const item = mono.items.get( target );
		const start = performance.now();
		const scale_start = item.X.scale;
		const scale_delta = scale_end - scale_start;
		if(!duration) duration = 300;
		const end = start + duration;
		
		return function( now, delta ){
			if( now > end ) now = end;
			const pos = ( now - start ) / duration;
			const scale = ( scale_delta * pos ) + scale_start;

			let z = 1;
			if( scale > 1 ) z++;
			if( item.grabbed ) z++;
			if( target.style['z-index'] != z ){ // typecasting
				//log('z-index', z, target.id, scale, item.grabbed);
				target.style['z-index'] = z;
			}

			// TODO: Calculate shadow from scale
			
			item.X.scale = item.Y.scale = scale;
			
			if( now == end ) return false;
			return true;
		};
	}

	static animPosDrag( target, axis ){
		const mono = MvSorter._monostate;
		const item = mono.items.get( target );
		const A = item[axis];
		const axB = MvSorter.axisB(axis);
		const B = item[axB];
		const friction = 0.01;
		const pos_acc = 0.04;
		const rot_max = 1.6;
		const pointer_distance = A.size * 2;
		//log( axis, A.size );
		let last_zonecheck = A.pos;
		const slowUpdateStep = 100;
		let slowUpdateLast = performance.now();
		//log("add drag", target, item.posX);
		
		return function( now, delta ){
			const pos_now = A.pos;
			const pos_end = A.pos_end;
			const pos_delta = pos_end - pos_now;
			let pos_speed = A.pos_speed || 0;
			//const pos = delta / duration;
			pos_speed += pos_delta * pos_acc;
			pos_speed *= friction ** pos_acc;
			
			const dir = axis == 'X' ? 1 : -1;
			B.rotate = dir * Math.atan(pos_delta / pointer_distance );
			if( B.rotate > rot_max ) B.rotate = rot_max;
			else if( B.rotate < -rot_max ) B.rotate = - rot_max;

			//log('rotate', axis, B.rotate );
			A.t_origin = A.pos + A.offset_handle + A.mid_handle;
			
			//log( axis, A.pos_speed, pos_delta, A.pos_end );
			
			A.pos_speed = pos_speed;
			A.pos = pos_now + pos_speed * delta/16;

			if( slowUpdateLast + slowUpdateStep < now ){
				if( Math.abs( last_zonecheck - A.pos ) >= 1 ){
					item.container.find_dropzone( target );
					last_zonecheck = A.pos;
				}
				slowUpdateLast = now;
			}

			return true; // Will remove this on drop
		}
	}


	static animRotateRecover( target, axis ){
		const mono = MvSorter._monostate;
		const item = mono.items.get( target );
		const A = item[axis];
		const recoup = 0.9;

		return function( now, delta ){
			A.rotate *= recoup;
			//log('rotate recover', axis, A.rotate);

			if( item.grabbed ){
				return false;
			}

			if( A.rotate < 0.01 ){
				A.rotate = 0;
				return false;
			}
			//log( A.rotate );

			return true; // Will remove this on drop
		}
	}


	static animPosFall( target, axis ){
		const mono = MvSorter._monostate;
		const item = mono.items.get( target );
		const A = item[axis];
		const B = item[MvSorter.axisB(axis)];
		const pos_acc = .8;
		const friction = .9;
		//const friction = .999; // slow
		const midAirSlow = 2;
		const flyby_speed = 20;
		
		return function( now, delta ){
			const pos_now = A.pos;
			const pos_end = A.pos_end;
			const pos_delta = pos_end - pos_now;

			let pos_speed = A.pos_speed || 0;
			const dir = pos_now > pos_end ? -1 : 1;

			//log( 'fall', axis, target.id, pos_delta, pos_speed );
			
			if( pos_delta ) pos_speed +=  pos_acc * dir;

			// apply friction if we are going in the wrong direction
			if( dir * pos_speed < 0 ){
				pos_speed *= friction;
			}

			// Additional friction if we are close to end
			//if( Math.abs( pos_delta * 2 ) < A.size ){
			//	pos_speed *= friction;
			//	if( Math.abs(pos_speed) < flyby_speed ) A.turned = true;
			//}

			// find closest target at the point of turning
			if( item.throwed ){
				if( Math.abs( pos_speed ) < midAirSlow ){
					if( !A.turned ){
						//log(`Turning ${target.id} ${axis} (${A.pos}) speed ${pos_speed}` );
						
						item.container.find_dropzone( target );
						
						// anim both since we check pos in animScaleCrash 
						for( let axis of ['X','Y'] ){
							item[axis].pos_end = item[axis].pos_home;
							MvSorter.addAnim('pos'+axis, MvSorter.animPosFall(target,axis), target);
						}
						
						A.turned = true;
					}
				} else if( A.turned ){
					//log(`Turning ${target.id} ${axis} - RESET ${pos_speed}` );
					//A.turned = false;
				}
			}
			
			const pos = pos_now + pos_speed * delta/16;

			A.pos_speed = pos_speed;

			if(
				dir * (pos_delta - pos_speed) <= 0 &&
				Math.abs( B.pos - B.pos_end ) < B.size/2 &&
				Math.abs(pos_speed) < flyby_speed
			){
				//log(`${target.id} ${item.container.mv.id}.${item.idx} THUMP ${axis} (${Math.floor(item.X.pos)},${Math.floor(item.Y.pos)}) -> (${Math.floor(item.X.pos_end)},${Math.floor(item.Y.pos_end)}) ${pos_speed}`);
				A.pos = pos_end;
				MvSorter.addAnim('scale'+axis, MvSorter.animScaleCrash(target,axis), target );

				if( A.scale !== 1 )
					MvSorter.addAnim('scale', MvSorter.animScale(target, 1, 75), target);

				if( item.throwed ){
					target.classList.remove('moved');
				}

				return false;
			}

			//log( 'animPosFall', axis, item.container.mv.id, target.id, pos );
			A.pos = pos;

			return true;
		}
	}

	static animScaleCrash( target, axis ){
		const mono = MvSorter._monostate;
		const item = mono.items.get(target);
		const A = item[axis];
		//const recoup = .5;
		const recoup = .6;
		//const duration = 20;
		const pos_acc = .8;
		
		return function( now, delta ){
			let speed = A.pos_speed || 0;
			//const pos_acc = delta / duration;
			const speedAbs =  Math.abs( speed ) * pos_acc ;
			const dir = A.scale_dir || (speed < 0 ? -1 : 1 );
			const force = delta/16 * pos_acc * recoup * (A.scale_force || 0) + speedAbs;

			A.crashed = true;
			
			const at_home = item.X.pos == item.X.pos_home && item.Y.pos == item.Y.pos_home;
			
			const compr = A.size / (A.size + force );

			//log(`Crash ${axis} ${item.throwed} ${at_home} ${compr} ${force} (${Math.floor(item.X.pos)},${Math.floor(item.Y.pos)}) ${A.pos_speed}`);
			

			if( speedAbs < 1 && force < 1 ){
				A.pos_speed = 0;
				A.scale_force = 0;
				A.scale = 1;
				delete A.scale_dir;

				//log('item settled', item._id);
				
				// Update children containers
				for( let child_cont of item.children_containers ){
					child_cont.container_moved();
				}

				
				// RESET
				if( item.throwed && at_home ){

					/* TODO: restore original z-index */
					if( item.container.mv.parent_target ){
						//log('z-index', 0, item.container.mv.parent_target.id);
						item.container.mv.parent_target.style['z-index'] = 0;
					}

					item.X.crashed = false;
					item.Y.crashed = false;
					item.throwed = false;

					MvSorter.item_moved( target );
				}

				return false;
			}

			speed *= pos_acc;
			
			A.pos_speed = speed;
			A.scale_force = force;
			A.scale_dir = dir;
			A.scale = compr;

			if( dir < 0 ){
				A.t_origin = A.pos + 0;
			} else if( dir > 0 ){
				A.t_origin = A.pos + A.size;
			}
			
			//if( item.throwed ){
			//	log( 'animScaleCrash', axis, speedAbs, force, compr );
			//}

			return true;
		}
	}

	static desig( target ){
		if( target.id ) return target.id;
		if( target.firstChild ){
			if( target.firstChild.textContent ){
				return target.firstChild.textContent;
			}
		}
		return '?';
	}

	// from http://jsfiddle.net/justin_c_rounds/Gd2S2/light/
	static checkLineIntersection(
		line1StartX, line1StartY, line1EndX, line1EndY,
		line2StartX, line2StartY, line2EndX, line2EndY )
	{
		// if the lines intersect, the result contains the x and y of
		// the intersection (treating the lines as infinite) and booleans
		// for whether line segment 1 or line segment 2 contain the point
		
		let denominator, a, b, numerator1, numerator2;
		const result = {
			x: null,
			y: null,
			onLine1: false,
			onLine2: false
		};

		denominator =
			((line2EndY - line2StartY) * (line1EndX - line1StartX)) -
			((line2EndX - line2StartX) * (line1EndY - line1StartY));
		if (denominator == 0) {
			return result;
		}

		a = line1StartY - line2StartY;
		b = line1StartX - line2StartX;
		numerator1 =
			((line2EndX - line2StartX) * a) -
			((line2EndY - line2StartY) * b);

		numerator2 =
			((line1EndX - line1StartX) * a) -
			((line1EndY - line1StartY) * b);

		a = numerator1 / denominator;
		b = numerator2 / denominator;

		// if we cast these lines infinitely in both directions, they
		// intersect here:

				result.x = line1StartX + (a * (line1EndX - line1StartX));
		result.y = line1StartY + (a * (line1EndY - line1StartY));

		// if line1 is a segment and line2 is infinite, they intersect if:
							 if (a > 0 && a < 1) {
								 result.onLine1 = true;
							 }

		// if line2 is a segment and line1 is infinite, they intersect if:
							 if (b > 0 && b < 1) {
								 result.onLine2 = true;
							 }

		// if line1 and line2 are segments, they intersect if both of the
		// above are true
		return result;
	}

}

customElements.define(MvSorter.is, MvSorter);
export default MvSorter;
