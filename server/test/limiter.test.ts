import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Limiter } from '../src/limiter.js'

test('a burst is allowed up to the capacity, then refused', () => {
  const limiter = new Limiter(3, 60)
  assert.equal(limiter.take('a'), 0)
  assert.equal(limiter.take('a'), 0)
  assert.equal(limiter.take('a'), 0)
  assert.ok(limiter.take('a') > 0, 'the fourth call should be told to wait')
})

test('keys do not spend each other’s budget', () => {
  const limiter = new Limiter(1, 60)
  assert.equal(limiter.take('a'), 0)
  assert.ok(limiter.take('a') > 0)
  assert.equal(limiter.take('b'), 0, 'a different caller starts fresh')
})

test('the wait it reports is proportional to the refill rate', () => {
  const fast = new Limiter(1, 60) // one per second
  const slow = new Limiter(1, 1) // one per minute
  fast.take('x')
  slow.take('x')
  assert.ok(slow.take('x') > fast.take('x'), 'a slower bucket makes you wait longer')
})

test('clearing forgives a key', () => {
  const limiter = new Limiter(1, 1)
  limiter.take('a')
  assert.ok(limiter.take('a') > 0)
  limiter.clear('a')
  assert.equal(limiter.take('a'), 0)
})

test('the sweep drops buckets that have refilled', () => {
  const limiter = new Limiter(2, 60)
  limiter.take('a')
  assert.equal(limiter.size, 1)
  limiter.sweep(Date.now())
  assert.equal(limiter.size, 1, 'a bucket still refilling is kept')
  limiter.sweep(Date.now() + 60_000)
  assert.equal(limiter.size, 0, 'a bucket back to full says nothing worth storing')
})
