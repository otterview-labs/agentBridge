const {test}=require('node:test');const assert=require('node:assert/strict');
const {failure}=require('../app/src/main/assets/butler-layout.js');
test('butler summaries distinguish a timed quota from auth and keep unknown errors generic',()=>{
 assert.match(failure('HTTP 403: You have reached your 5-hour usage limit').text,/5 小时/);
 assert.doesNotMatch(failure('HTTP 403: You have reached your 5-hour usage limit').text,/密钥/);
 assert.match(failure('HTTP 401: invalid token').text,/HTTP 401/);
 assert.match(failure('HTTP 429: too many requests').text,/429/);
 assert.match(failure('HTTP 404: model missing').text,/404/);
 assert.match(failure('insufficient_quota').title,/额度/);
 assert.doesNotMatch(failure('arbitrary server markup <img src=x>').text,/<img/);
});
