const {test}=require('node:test');
const assert=require('node:assert/strict');
const {presets,brands,detect,parseModelConfig}=require('../app/src/main/assets/model-providers.js');

test('model service presets expose eight brands and distinguish membership credentials',()=>{
  assert.equal(brands.length,8);
  assert.equal(new Set(Object.values(presets).map(p=>p.brand)).size,8);
  for(const [key,preset] of Object.entries(presets)) {
    if(key==='custom')continue;
    assert.equal(new URL(preset.baseUrl).protocol,'https:');
    assert.equal(preset.apiKey,undefined);
    assert.equal(detect(preset.baseUrl+'/chat/completions/'),key);
  }
  assert.notEqual(presets['kimi-code'].baseUrl,presets['kimi-open'].baseUrl);
  assert.notEqual(presets.volcengine.baseUrl,presets['volcengine-plan'].baseUrl);
  assert.equal(detect('https://api.kimi.com/coding/v1/'),'kimi-code');
  assert.equal(detect('https://api.kimi.com.evil.test/coding/v1'),'custom');
  assert.equal(detect('https://api.kimi.com/coding/v1?key=bad'),'custom');
});

test('model JSON import handles common aliases without executing or retaining input',()=>{
  assert.deepEqual(parseModelConfig(JSON.stringify({OPENAI_BASE_URL:'https://gateway.example/v1',OPENAI_MODEL:'custom-model',OPENAI_API_KEY:'test-only'})),{baseUrl:'https://gateway.example/v1',modelId:'custom-model',apiKey:'test-only'});
  for(const raw of ['[]','{}','null','bad',JSON.stringify({baseUrl:'https://x/v1?api_key=bad',model:'m'}),JSON.stringify({baseUrl:'javascript:alert(1)',model:'m'}),JSON.stringify({baseUrl:'https://x/v1',model:'x'.repeat(161)})])assert.throws(()=>parseModelConfig(raw));
});
