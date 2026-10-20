import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';

const main = readFileSync('index.html', 'utf8');
const arena = readFileSync('arena/index.html', 'utf8');
const cloud = readFileSync('cloud.js', 'utf8');

function inlineScripts(source, filename) {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
  assert.ok(scripts.length, filename + ': no inline scripts to verify');
  for (const [i, script] of scripts.entries()) new Script(script, {filename: filename + '#script-' + (i+1)});
  return scripts.length;
}
const mainScripts = inlineScripts(main, 'index.html');
const arenaScripts = inlineScripts(arena, 'arena/index.html');
new Script(cloud, {filename:'cloud.js'});

function contains(haystack,needle,message) {
  assert.ok(haystack.includes(needle), message + ' (missing ' + needle + ')');
}
contains(main,'href="arena/"','Top-level 2D Arena must be discoverable');
contains(main,'function renderArenaEntry()','Battle page needs a persistent 2D Arena callout');
contains(main,'DIGITAL GAME PACKS — NOT REAL PRODUCTS','Game packs must be clearly virtual');
contains(main,'Open a virtual pack','Open pack button must not imply physical purchases');
contains(main,'data-action="open-account"','Account entry button is missing');
contains(main,'mobile-account-link','Mobile account navigation is missing');
contains(main,'grid-template-areas:"brand account" "stats stats"','Account must remain visible on mobile');
contains(main,'script src="cloud.js"','Account integration script is missing');
contains(cloud,'packlabTrainerNameForm','Trainer Name editor is missing');
contains(cloud,"err?.code==='23505'",'Case-insensitive username collision handling is missing');
contains(cloud,"'☁ Account'",'Guest account entry must be visible');
contains(arena,'../#account','Arena must link back to Account');
contains(arena,'VIRTUAL GAME ONLY','Arena virtual-item disclosure is missing');
contains(arena,'attackNextReady','Next-ready combat must be present');
contains(arena,'TAG TEAM','TAG TEAM battler is missing');
assert.ok(!main.includes('verified English booster packs'),'Store must not imply official physical packs');
console.log('PASS: ' + (mainScripts+arenaScripts+1) + ' JavaScript sources parsed and key Arena, Account, virtual-pack routes verified');
