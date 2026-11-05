import { Sess } from '@sess.si/sdk';
const sess = new Sess({ apiKey: process.env.SESS_API_KEY });
const feedback = await sess.ask({
  question: 'How did we do?',
  fields: [
    { name: 'satisfaction', label: 'Your visit', type: 'rating' },
    { name: 'comment', label: 'Anything else?', type: 'text', multiline: true, required: false },
  ],
});
console.log(`Send this Sess link to the person: ${feedback.link}`);
const { satisfaction, comment } = await feedback.answer(); // verified; satisfaction is 1 to 5
console.log(`Rated ${satisfaction} of 5.${comment ? ` They said: ${comment}` : ''}`);
