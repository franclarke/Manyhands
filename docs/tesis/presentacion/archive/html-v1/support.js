/**
 * support.js — Runtime para visualización directa de archivos Claude Design Canvas (.dc.html)
 * Permite ejecutar Main.dc.html en cualquier navegador estándar sin el editor propietario.
 */

class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this._listeners = new Map();
  }

  setState(partialState, callback) {
    if (typeof partialState === 'function') {
      this.state = Object.assign({}, this.state, partialState(this.state));
    } else if (typeof partialState === 'object' && partialState !== null) {
      this.state = Object.assign({}, this.state, partialState);
    }
    if (window.__dcRuntime) {
      window.__dcRuntime.render();
    }
    if (typeof callback === 'function') {
      callback();
    }
  }
}

(function () {
  'use strict';

  // Expose global DCLogic
  window.DCLogic = DCLogic;

  document.addEventListener('DOMContentLoaded', () => {
    const xdc = document.querySelector('x-dc');
    if (!xdc) return;

    // Preserve raw template
    const rawHTML = xdc.innerHTML;
    let componentInstance = null;

    const runtime = {
      render() {
        if (!componentInstance || typeof componentInstance.renderVals !== 'function') return;
        const vals = componentInstance.renderVals();

        // 1. Replace template expressions {{key}} in HTML
        let processedHTML = rawHTML;
        
        // Handle styles and variables
        for (const [key, value] of Object.entries(vals)) {
          if (typeof value === 'function') continue;
          const reg = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          processedHTML = processedHTML.replace(reg, String(value));
        }

        // Apply HTML
        xdc.innerHTML = processedHTML;

        // 2. Bind event listeners
        const prevBtns = xdc.querySelectorAll('[onClick*="prev"], .nav-prev');
        prevBtns.forEach(btn => {
          btn.onclick = (e) => {
            e.preventDefault();
            if (typeof vals.prev === 'function') vals.prev();
          };
        });

        const nextBtns = xdc.querySelectorAll('[onClick*="next"], .nav-next');
        nextBtns.forEach(btn => {
          btn.onclick = (e) => {
            e.preventDefault();
            if (typeof vals.next === 'function') vals.next();
          };
        });
      }
    };

    window.__dcRuntime = runtime;

    // Find script with Component definition
    const script = document.querySelector('script[data-dc-script]');
    if (script && typeof Component === 'function') {
      let defaultProps = {};
      try {
        const rawProps = script.getAttribute('data-props');
        if (rawProps) {
          const parsed = JSON.parse(rawProps);
          for (const [k, v] of Object.entries(parsed)) {
            if (v && v.default !== undefined) {
              defaultProps[k] = v.default;
            }
          }
        }
      } catch (e) {
        console.warn('Error parsing data-props', e);
      }

      componentInstance = new Component(defaultProps);
      runtime.render();

      if (typeof componentInstance.componentDidMount === 'function') {
        componentInstance.componentDidMount();
      }
    }
  });
})();
