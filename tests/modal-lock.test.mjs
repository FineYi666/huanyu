import test from 'node:test'
import assert from 'node:assert/strict'
import { lockPageScroll } from '../src/modal-lock.ts'

test('nested dialogs retain the page scroll lock until the final dialog closes and restore existing styles', () => {
  const previous = globalThis.document
  const root = {style:{overflow:'clip',scrollbarGutter:'auto'},dataset:{modalOpen:'false'}}
  const body = {style:{overflow:'auto'}}
  globalThis.document = {documentElement:root,body}
  try {
    const outer = lockPageScroll(), inner = lockPageScroll()
    assert.equal(root.style.overflow,'hidden')
    assert.equal(body.style.overflow,'hidden')
    assert.equal(root.dataset.modalOpen,'true')
    outer()
    outer() // A repeated cleanup must not unlock another open dialog.
    assert.equal(root.style.overflow,'hidden')
    assert.equal(root.dataset.modalOpen,'true')
    inner()
    assert.equal(root.style.overflow,'clip')
    assert.equal(body.style.overflow,'auto')
    assert.equal(root.style.scrollbarGutter,'auto')
    assert.equal(root.dataset.modalOpen,'false')
    delete root.dataset.modalOpen
    const reopened = lockPageScroll()
    reopened()
    assert.equal(root.dataset.modalOpen,undefined)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})
