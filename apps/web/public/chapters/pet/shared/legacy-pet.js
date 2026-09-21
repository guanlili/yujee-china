export function initialState() {
  return {
    version: 1, activePetId: 'naitang',
    pets: [
      {id:'naitang',name:'奶糖',species:'cat',ownerName:'阿鱼',personality:'有点傲娇',adoptedAt:'2024-03-21',bio:'窗边的阳光、沙发的一角，还有你。\n这些，就是我的整个世界。',avatar:'/photos/cat-portrait.jpg',sample:true},
      {id:'sesame',name:'芝麻',species:'cat',ownerName:'阿鱼',personality:'安静温柔',adoptedAt:'2025-01-12',bio:'不太爱说话，但喜欢待在离你很近的地方。',avatar:'/photos/cat-home.jpg',sample:true},
      {id:'cookie',name:'曲奇',species:'dog',ownerName:'阿鱼',personality:'热情好奇',adoptedAt:'2025-05-18',bio:'出门是最好的事。和你一起出门，是更好的事。',avatar:'/photos/dog.jpg',sample:true},
    ],
    memories: [
      {id:'m1',petIds:['naitang'],title:'你忙你的，我陪我的',date:'2026-09-05',location:'家里的午后',human:'周末在家赶方案，奶糖占据了桌边最好的位置。抬头看见它，突然觉得，慢一点也没关系。',pet:'你又在和那个发光的盒子说话。\n我不太懂你的工作，但我知道，\n你一抬头，就应该看见我。',image:'/photos/cat-portrait.jpg',sample:true,createdAt:'2026-09-05T14:00:00.000Z'},
      {id:'m2',petIds:['naitang'],title:'今天的阳光，分你一半',date:'2026-08-24',location:'窗边',human:'没有出门的一天。看着它晒太阳，我也搬了把椅子过来。我们安静地待了一个下午。',pet:'这块阳光本来是我的。\n不过，如果是你，\n我可以往旁边挪一点。',image:'/photos/cat-sleep.jpg',sample:true,createdAt:'2026-08-24T14:00:00.000Z'},
      {id:'m3',petIds:['naitang','sesame'],title:'家里多了一个小伙伴',date:'2026-07-18',location:'客厅',human:'奶糖和芝麻终于愿意待在同一个房间里了。不一定要挨在一起，互相留一点空间，也是一种陪伴。',pet:'那个新来的，今天没有抢我的位置。\n那好吧。\n这间屋子，也分你一点。',image:'/photos/cat-home.jpg',sample:true,createdAt:'2026-07-18T14:00:00.000Z'},
      {id:'m4',petIds:['naitang'],title:'平凡的一天，也想记住',date:'2026-06-08',location:'家的角落',human:'整理照片才发现，手机里多了好多它的照片。没有特别的纪念日，只是想把这些小日子留住。',pet:'你说今天没什么特别的。\n可是有饭，有太阳，还有你。\n我觉得已经很好了。',image:'/photos/cat-portrait.jpg',sample:true,createdAt:'2026-06-08T14:00:00.000Z'},
      {id:'m5',petIds:['cookie'],title:'再走一小段，好不好',date:'2026-09-03',location:'散步路上',human:'傍晚带曲奇出门，原本只想走十分钟，最后绕了远路。它好像总有办法，让我多看一会儿这个世界。',pet:'你说该回家了。\n可是拐角那边的风，我还没闻过。\n再陪我走一小段，好不好？',image:'/photos/dog.jpg',sample:true,createdAt:'2026-09-03T14:00:00.000Z'},
    ],
    relationships:[{id:'r1',from:'naitang',to:'sesame',label:'慢慢熟悉的室友'},{id:'r2',from:'naitang',to:'cookie',label:'一起生活的伙伴'}]
  };
}
