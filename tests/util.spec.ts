import { describe, expect, test } from 'vitest'
import { camel } from '../src/util.ts'

describe('Utility Functions', () => {
  describe('camel', () => {
    test('converts kebab-case to camelCase', () => {
      expect(camel('first-name')).toBe('firstName')
      expect(camel('last-name')).toBe('lastName')
      expect(camel('some-long-property-name')).toBe('someLongPropertyName')
    })

    test('handles single words', () => {
      expect(camel('name')).toBe('name')
      expect(camel('id')).toBe('id')
    })

    test('handles already camelCase strings', () => {
      expect(camel('firstName')).toBe('firstName')
      expect(camel('lastName')).toBe('lastName')
    })

    test('handles unicode characters', () => {
      expect(camel('first-ñame')).toBe('firstÑame')
      expect(camel('über-name')).toBe('überName')
    })

    test('handles empty string', () => {
      expect(camel('')).toBe('')
    })
  })
})
