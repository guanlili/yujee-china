export function registerMemoryTools(context, actions) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools = [
    {name:'list_pet_memories',title:'查看当前宠物的回忆',description:'读取当前宠物档案及其回忆标题，不导出照片或修改数据。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('Expected an empty object');return actions.list();}},
    {name:'set_memory_perspective',title:'切换回忆叙述视角',description:'把当前可见相册切换为人或宠物视角，不修改已保存故事。',inputSchema:{type:'object',properties:{perspective:{type:'string',enum:['human','pet']}},required:['perspective'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!['human','pet'].includes(input.perspective))throw new Error('perspective must be human or pet');return actions.setPerspective(input.perspective);}}
  ];
  for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(error=>console.warn('Memory tool unavailable:',error.message));}catch(error){console.warn('Memory tool unavailable:',error.message);}}
  return ()=>lifecycle.abort();
}
