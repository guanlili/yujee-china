import type { InterviewCase } from '../interview';

export const zh: Record<InterviewCase, readonly [string, string, string]> = {
  timeAndPlace: [
    '这组照片我大概整理好啦～',
    '不过想再多了解一点：当时是和谁一起的呀？',
    '有没有什么特别的人、事，或者心情，想记进这本相册里？',
  ],
  timeOnly: [
    '这组照片挺有感觉的～',
    '是在哪儿拍的呀？当时和谁在一起？',
    '有什么想留下的回忆或心情，都可以跟我说说。',
  ],
  placeOnly: [
    '这组照片我看过啦～',
    '大概是什么时候拍的呀？和谁一起的？',
    '有没有特别想记录的故事或心情？',
  ],
  neither: [
    '想更懂这组照片一点～',
    '大概是什么时候、在哪、和谁一起拍的呀？',
    '当时发生了什么、心情怎样，随便聊聊都行。',
  ],
};
