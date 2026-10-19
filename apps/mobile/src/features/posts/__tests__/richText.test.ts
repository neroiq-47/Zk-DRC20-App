import { describe, expect, it } from '@jest/globals';
import { extractHashtags, extractMentions, parseRichText } from '../richText';

describe('parseRichText', () => {
  it('returns plain text untouched', () => {
    expect(parseRichText('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
    expect(parseRichText('')).toEqual([]);
  });

  it('finds hashtags, mentions and links', () => {
    expect(parseRichText('Hi @alice_01 see #Zoko at https://zoko.app/x.')).toEqual([
      { type: 'text', text: 'Hi ' },
      { type: 'mention', text: '@alice_01', handle: 'alice_01' },
      { type: 'text', text: ' see ' },
      { type: 'hashtag', text: '#Zoko', tag: 'Zoko' },
      { type: 'text', text: ' at ' },
      { type: 'link', text: 'https://zoko.app/x', url: 'https://zoko.app/x' },
      { type: 'text', text: '.' },
    ]);
  });

  it('handles tokens at the start and adjacent punctuation', () => {
    expect(parseRichText('#gm, @bob!')).toEqual([
      { type: 'hashtag', text: '#gm', tag: 'gm' },
      { type: 'text', text: ', ' },
      { type: 'mention', text: '@bob', handle: 'bob' },
      { type: 'text', text: '!' },
    ]);
  });

  it('ignores emails, numeric tags, mid-word hashes and too-short handles', () => {
    expect(parseRichText('mail me at a@b.com')).toEqual([{ type: 'text', text: 'mail me at a@b.com' }]);
    expect(parseRichText('we are #1')).toEqual([{ type: 'text', text: 'we are #1' }]);
    expect(parseRichText('C#sharp')).toEqual([{ type: 'text', text: 'C#sharp' }]);
    expect(parseRichText('hi @ab')).toEqual([{ type: 'text', text: 'hi @ab' }]);
  });

  it('supports unicode hashtags and www links', () => {
    const segs = parseRichText('#café www.example.com');
    expect(segs[0]).toEqual({ type: 'hashtag', text: '#café', tag: 'café' });
    expect(segs[2]).toEqual({ type: 'link', text: 'www.example.com', url: 'https://www.example.com' });
  });

  it('does not treat #fragments inside links as hashtags', () => {
    expect(parseRichText('https://x.io/a#b')).toEqual([{ type: 'link', text: 'https://x.io/a#b', url: 'https://x.io/a#b' }]);
  });
});

describe('extract helpers', () => {
  it('dedupes and lowercases', () => {
    expect(extractHashtags('#Doge #doge #wow')).toEqual(['doge', 'wow']);
    expect(extractMentions('@Alice and @alice and @bob_')).toEqual(['alice', 'bob_']);
  });
});
