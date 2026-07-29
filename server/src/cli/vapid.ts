/*
 * Generates the key pair that lets this server push to browsers:
 *
 *   npm run vapid --prefix server
 *
 * The public key is handed to the browser when it subscribes; the private one
 * signs every push. Replacing them invalidates every existing subscription,
 * so generate once and keep them with the rest of the secrets.
 */

import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log(`VAPID_SUBJECT=mailto:vous@exemple.fr`)
