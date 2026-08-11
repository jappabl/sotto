// A calendar holds appointments with people and blocks you put on your own
// day. Only the first kind should reach briefs or name a recording.
const { test } = require('node:test');
const assert = require('assert');
const { isMeeting, conferenceUrl } = require('../../electron/calendar');

test('events with other people are meetings', () => {
  assert.equal(isMeeting({ title: 'Pricing sync', attendees: [{ name: 'Sarah Chen' }] }), true);
  assert.equal(isMeeting({ title: 'Intro', attendees: [{ email: 'a@acme.io' }] }), true);
});

test('solo blocks are not meetings', () => {
  assert.equal(isMeeting({ title: 'Gym', attendees: [], free: true }), false);
  assert.equal(isMeeting({ title: 'Focus time', attendees: [] }), false);
  assert.equal(isMeeting({ title: 'Lunch', attendees: [], location: 'Cafe' }), false);
  assert.equal(isMeeting(null), false);
});

test('a video link makes it a meeting even with no attendee list', () => {
  assert.equal(isMeeting({ title: 'Sync', attendees: [], location: 'https://acme.zoom.us/j/99123' }), true);
  assert.equal(isMeeting({ title: 'Sync', attendees: [], notes: 'https://meet.google.com/abc-defg-hij' }), true);
});

test('declined meetings are not yours', () => {
  assert.equal(isMeeting({ title: 'Standup', myStatus: 'declined', attendees: [{ name: 'A' }] }), false);
  assert.equal(isMeeting({ title: 'Standup', myStatus: 'accepted', attendees: [{ name: 'A' }] }), true);
  assert.equal(isMeeting({ title: 'Standup', myStatus: 'pending', attendees: [{ name: 'A' }] }), true);
});

test('conference links are found in location, url, or notes', () => {
  assert.equal(conferenceUrl({ location: 'https://acme.zoom.us/j/99123' }), 'https://acme.zoom.us/j/99123');
  assert.equal(conferenceUrl({ url: 'https://teams.microsoft.com/l/meetup-join/xyz' }),
    'https://teams.microsoft.com/l/meetup-join/xyz');
  // Trailing punctuation from prose must not end up in the link.
  assert.equal(conferenceUrl({ notes: 'Join (https://meet.google.com/abc-defg-hij).' }),
    'https://meet.google.com/abc-defg-hij');
  assert.equal(conferenceUrl({ location: 'Conference room B' }), null);
});
