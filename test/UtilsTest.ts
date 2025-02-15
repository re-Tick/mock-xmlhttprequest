import { assert } from 'chai';

import { getBodyByteSize } from '../src/Utils';

class BlobMock {
  constructor(array: any[]) {
    assert.isArray(array);
  }

  static testSize = 0;

  get size() { return BlobMock.testSize; }
}

class BufferSourceMock {
  constructor(public byteLength: number) {}
}

class FormDataMock {
  private _values: any[];

  constructor() {
    this._values = [];
  }

  append(name: any, value: any) {
    this._values.push(value);
  }

  values() {
    return this._values.values();
  }
}

describe('Utils', () => {
  describe('getBodyByteSize', () => {
    it('should return 0 for empty body', () => {
      assert.strictEqual(getBodyByteSize(), 0);
      assert.strictEqual(getBodyByteSize(null), 0);
    });

    it('should return string byte length using Blob', () => {
      // The Blob code path of getBodyByteSize() requires Blob in the global context.
      const savedBlob = globalThis.Blob;
      globalThis.Blob = BlobMock as unknown as typeof globalThis.Blob;
      try {
        // Doesn't match the string size below on purpose to validate that the Blob mock is used
        BlobMock.testSize = 10;
        assert.strictEqual(getBodyByteSize('abcd'), 10, 'uses the Blob size');
      } finally {
        globalThis.Blob = savedBlob;
      }
    });

    it('should return string byte length using BufferSource', () => {
      assert.strictEqual(getBodyByteSize('abcd'), 4, 'single code unit characters');
      assert.strictEqual(getBodyByteSize('😂👍'), 8, 'multi code unit characters');
      assert.strictEqual(getBodyByteSize('a😂b👍c'), 11, 'mixed code unit characters');
    });

    it('should return Blob byte size', () => {
      // Doesn't match the string size below on purpose to validate that the Blob mock is used
      BlobMock.testSize = 10;
      const blob = new BlobMock(['abcd']);
      assert.strictEqual(getBodyByteSize(blob as Blob), 10);
    });

    it('should return BufferSource byte size', () => {
      const bufferSource = new BufferSourceMock(10);
      assert.strictEqual(getBodyByteSize(bufferSource as BufferSource), 10);
    });

    it('should return FormData byte size', () => {
      // The FormData code path of getBodyByteSize() requires FormData in the global context.
      const savedFormData = globalThis.FormData;
      globalThis.FormData = FormDataMock as unknown as typeof globalThis.FormData;
      try {
        const form = new FormDataMock();
        form.append('my_field', 'abcd');
        form.append('my_emojis', '😂👍');

        // Doesn't match the string size below on purpose to validate that the Blob mock is used
        BlobMock.testSize = 10;
        form.append('my_blob', new BlobMock(['abcd']));
        assert.strictEqual(getBodyByteSize(form as unknown as FormData), 4 + 8 + 10);
      } finally {
        globalThis.FormData = savedFormData;
      }
    });
  });
});
