import 'dotenv/config';
import { scorpFetch } from '../providers/scorp.js';


const ig = process.argv[2] || 'https://www.instagram.com/reel/DK2CqyuN2VT/?utm_source=ig_web_copy_link';


scorpFetch(ig)
    .then((list) => {
        console.log('Found:', list.length);
        console.log(list);
    })
    .catch((e) => {
        console.error('ERR', e?.response?.status, e?.response?.data || e.message);
    });