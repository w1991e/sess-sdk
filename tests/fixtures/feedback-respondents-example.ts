import { Sess } from '@sess.si/sdk';
const sess = new Sess({ apiKey: process.env.SESS_API_KEY });
const feedback = await sess.ask({
  question: 'How did we do?',
  fields: [
    { name: 'satisfaction', label: 'Your visit', type: 'rating' },
    { name: 'comment', label: 'Anything else?', type: 'text', multiline: true, required: false },
  ],
  respondents: { max: 25 },
});
console.log(`Share this link with today’s guests: ${feedback.link}`);
const { respondents } = await feedback.read();
const ratings = respondents.flatMap((r) => (r.answer ? [r.answer.satisfaction] : []));
const average = ratings.reduce((sum, n) => sum + n, 0) / ratings.length;
console.log(ratings.length ? `${ratings.length} rated us ${average.toFixed(1)} of 5.` : 'No ratings yet.');
