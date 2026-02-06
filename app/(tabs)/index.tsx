import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';

import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

import { runWalletFlow } from '@/utils/wallet-flow';
import {
  configureLogging,
  deriveKeysFromMnemonic,
  deriveKeysFromSeed,
  deriveKeysFromXpriv,
  generateKeys,
  getXprivFromMnemonic,
  getXpubFromXpriv,
  LogLevel,
  restoreKeys,
  signPsbt,
  ValidationError
} from '@utexo/rgb-sdk-rn';
// import wdk from '@tetherto/wdk';



const testMnemonic = 'poem twice question inch happy capital grain quality laptop dry chaos what';

const expectedKeys = {
  mnemonic: testMnemonic,
  xpub: 'tpubD6NzVbkrYhZ4XCaTDersU6277zvyyV6uCCeEgx1jfv7bUYMrbTt8Vem1MBt5Gmp7eMwjv4rB54s2kjqNNtTLYpwFsVX7H2H93pJ8SpZFRRi',
  accountXpubVanilla: 'tpubDDMTD6EJKKLP6Gx9JUnMpjf9NYyePJszmqBnNqULNmcgEuU1yQ3JsHhWZdRFecszWETnNsmhEe9vnaNibfzZkDDHycbR2rGFbXdHWRgBfu7',
  accountXpubColored: 'tpubDDPLJfdVbDoGtnn6hSto3oCnm6hpfHe9uk2MxcANanxk87EuquhSVfSLQv7e5UykgzaFn41DUXaikjjVGcUSUTGNaJ9LcozfRwatKp1vTfC',
  masterFingerprint: 'a66bffef',
};
  // UTXO creation PSBT (unsigned)
  const utxoUnsignedPsbt = 'cHNidP8BAP01AQIAAAABtSecjg4J41fmQtoh4TTlQdnu6iifN5ogbVWEAXrUWhoAAAAAAP3///8G6AMAAAAAAAAiUSDzKPGEYMWF2Spr+6GDDaiByz+OjfjlV3Lfr/zYKZ2iB+gDAAAAAAAAIlEg83490lnilgZRgrHnETy+JEjou1md47ACmb0kn5rO2+joAwAAAAAAACJRIHD6gvLQXWd4BvEW0YjxA0z50cxfC3ZUhKXnKhPTS1B+6AMAAAAAAAAiUSCXxMTRByl/+IGyzvdE6V+4ac0UOeEwe1dl3zb8ceaZ5OgDAAAAAAAAIlEg3oU2/GUMIeYj4d/R1dK5ThTLhkg7JAhjPOLjNqb215YYEzEBAAAAACJRIHn8VHdi5k8OITo7LrsqYr+cQIASgZTwvtfvYoBHBxpWoXVIAAABASsALTEBAAAAACJRIM9hxZBkyMxn4vyYOosTZEYQIMqQZRSwxigi1aTQwJLrIRaUhLceLJAwJvzah8652iBUot/I4ZG5LVNrof4L451TuRkApmv/71YAAIABAACAAAAAgAEAAAAAAAAAARcglIS3HiyQMCb82ofOudogVKLfyOGRuS1Ta6H+C+OdU7kAAQUgeHCOVR20fg1Bz+fM/Cpg3KrkSlmKQDLwInucZ2bCMcwhB3hwjlUdtH4NQc/nzPwqYNyq5EpZikAy8CJ7nGdmwjHMGQCma//vVgAAgB+fDIAAAACAAAAAAAIAAAAAAQUgzBIX4uwl2L4m53HESkMyqyevlalsmf3tw9nH0r3KQoIhB8wSF+LsJdi+JudxxEpDMqsnr5WpbJn97cPZx9K9ykKCGQCma//vVgAAgB+fDIAAAACAAAAAAAMAAAAAAQUgs43Fa7pRIMJTLGHkWwyCRf16wo3uSS/3CDv0c550QBkhB7ONxWu6USDCUyxh5FsMgkX9esKN7kkv9wg79HOedEAZGQCma//vVgAAgB+fDIAAAACAAAAAAAQAAAAAAQUgaqAn3Z3FYWYqPiTb2KCMBirkLH3ZnhE1Q7NpCOiuJBkhB2qgJ92dxWFmKj4k29igjAYq5Cx92Z4RNUOzaQjoriQZGQCma//vVgAAgB+fDIAAAACAAAAAAAEAAAAAAQUgnZNdhk/w7sXuE3/fLeNHq5My6f6IqMI5KrZAVeoZdnUhB52TXYZP8O7F7hN/3y3jR6uTMun+iKjCOSq2QFXqGXZ1GQCma//vVgAAgB+fDIAAAACAAAAAAAAAAAAAAQUg+5xo2r852/jJjwIpMPXdsWsse2hpIxAhJhP6YDPcrrIhB/ucaNq/Odv4yY8CKTD13bFrLHtoaSMQISYT+mAz3K6yGQCma//vVgAAgAEAAIAAAACAAQAAAAEAAAAA';
  
  // UTXO creation PSBT (signed - expected result)
  const utxoSignedPsbt = 'cHNidP8BAP01AQIAAAABtSecjg4J41fmQtoh4TTlQdnu6iifN5ogbVWEAXrUWhoAAAAAAP3///8G6AMAAAAAAAAiUSDzKPGEYMWF2Spr+6GDDaiByz+OjfjlV3Lfr/zYKZ2iB+gDAAAAAAAAIlEg83490lnilgZRgrHnETy+JEjou1md47ACmb0kn5rO2+joAwAAAAAAACJRIHD6gvLQXWd4BvEW0YjxA0z50cxfC3ZUhKXnKhPTS1B+6AMAAAAAAAAiUSCXxMTRByl/+IGyzvdE6V+4ac0UOeEwe1dl3zb8ceaZ5OgDAAAAAAAAIlEg3oU2/GUMIeYj4d/R1dK5ThTLhkg7JAhjPOLjNqb215YYEzEBAAAAACJRIHn8VHdi5k8OITo7LrsqYr+cQIASgZTwvtfvYoBHBxpWoXVIAAABASsALTEBAAAAACJRIM9hxZBkyMxn4vyYOosTZEYQIMqQZRSwxigi1aTQwJLrAQhCAUDrRtVkPLHRkFNKbYlEL3bgjs6wjkfkO7fZytofjY3WL7EIHD3W5I2YmVucb9aSFTGJEU2m9+9laoEebGTB8KAdAAEFIHhwjlUdtH4NQc/nzPwqYNyq5EpZikAy8CJ7nGdmwjHMAAEFIMwSF+LsJdi+JudxxEpDMqsnr5WpbJn97cPZx9K9ykKCAAEFILONxWu6USDCUyxh5FsMgkX9esKN7kkv9wg79HOedEAZAAEFIGqgJ92dxWFmKj4k29igjAYq5Cx92Z4RNUOzaQjoriQZAAEFIJ2TXYZP8O7F7hN/3y3jR6uTMun+iKjCOSq2QFXqGXZ1AAEFIPucaNq/Odv4yY8CKTD13bFrLHtoaSMQISYT+mAz3K6yAA==';
  
  // Send begin PSBT (unsigned)
  const sendUnsignedPsbt = 'cHNidP8BAIkCAAAAASs6FZbqRIdKgFpPLMi0aTfvBFqDT6JbTdDpK6P6tBhCBAAAAAD9////AgAAAAAAAAAAImog6wXBZTGshFceO1rQtCoz1eDEfgGcWdvMvHLJlmozjEKEAQAAAAAAACJRIBs/61D42aMRdH4+SEPBqOtdv4dNSIY5r8iJqACWZ5bv3XlIACb8A1JHQgH0bKC/icu0bP1eYxQ6uIpPwCU89RNB/G+yHcp4C0e3DJ0AAN1GxJO34z9oOLJIdFpzzqfl+e3voeFqTPSl45jd58mJ//////////8QJwAAAQDdRsSTt+M/aDiySHRac86n5fnt76Hhakz0peOY3efJiaAPAgABAKAPAQIAAAABAAAAaq+/lJND7LUI3gMAAAAAAAAB/GQgj9CN8+h6nKKR6li1Snudp05RyxxRBoOJ0VhYzfQICgAAAAAAAAAABvwDUkdCAgEAJvwDUkdCBN1GxJO34z9oOLJIdFpzzqfl+e3voeFqTPSl45jd58mJRN1GxJO34z9oOLJIdFpzzqfl+e3voeFqTPSl45jd58mJoA8CAPRsoL+Jy7Rs/V5jFDq4ik/AJTz1E0H8b7IdyngLR7cMAAEBK+gDAAAAAAAAIlEg3oU2/GUMIeYj4d/R1dK5ThTLhkg7JAhjPOLjNqb215YhFp2TXYZP8O7F7hN/3y3jR6uTMun+iKjCOSq2QFXqGXZ1GQCma//vVgAAgB+fDIAAAACAAAAAAAAAAAABFyCdk12GT/Duxe4Tf98t40erkzLp/oiowjkqtkBV6hl2dQAm/ANNUEMA3UbEk7fjP2g4skh0WnPOp+X57e+h4WpM9KXjmN3nyYkg/OYL9NoADeYnzQkU4TmgEJEIBWyTp0v1e1StQzxh8YYG/ANNUEMBCOSb4tcxJLMvBvwDTVBDECDrBcFlMayEVx47WtC0KjPV4MR+AZxZ28y8csmWajOMQgb8A01QQxH9PwEDAAAIAAAAAANp7skQJdswnsxrN/hH0Nzl+7GXQiel7Cq4pRCYRsvnkQAD78HzWyTQwyUtHa9FrbEEfmIcdwWoQ4MFewb7VuzpNOYAA617O8vSZCG3EdeaFfG/LLNx5vxK6Gd1mWukv9GGBr1CAANK4WCpInljss9tzwQ7WOcARnOZgXjE/5c2JsTrFZ17VwADkwf/OMoQPQy6+IHABqtMZdVjJJbK0fvFsDjEay6aqIkB3UbEk7fjP2g4skh0WnPOp+X57e+h4WpM9KXjmN3nyYn85gv02gAN5ifNCRThOaAQkQgFbJOnS/V7VK1DPGHxhgADNRqw8q4cMxyEceD9NOWnYfZBGtsLVvxmu96OG+cZgd4AA8wgXYyY/F/m1sEThgPwffAnxmAtQtAnMK9GhY82FnzLAeSb4tcxJLMvCPwFT1BSRVQBIOsFwWUxrIRXHjta0LQqM9XgxH4BnFnbzLxyyZZqM4xCAAEFIKu00zp2brpb5bM41nvP0Qkh9QiTklFIBPGRUophfkqnIQertNM6dm66W+WzONZ7z9EJIfUIk5JRSATxkVKKYX5KpxkApmv/71YAAIAfnwyAAAAAgAAAAAAGAAAAAA==';
  
  // Send begin PSBT (signed - expected result)
  const sendSignedPsbt = 'cHNidP8BAIkCAAAAASs6FZbqRIdKgFpPLMi0aTfvBFqDT6JbTdDpK6P6tBhCBAAAAAD9////AgAAAAAAAAAAImog6wXBZTGshFceO1rQtCoz1eDEfgGcWdvMvHLJlmozjEKEAQAAAAAAACJRIBs/61D42aMRdH4+SEPBqOtdv4dNSIY5r8iJqACWZ5bv3XlIACb8A1JHQgH0bKC/icu0bP1eYxQ6uIpPwCU89RNB/G+yHcp4C0e3DJ0AAN1GxJO34z9oOLJIdFpzzqfl+e3voeFqTPSl45jd58mJ//////////8QJwAAAQDdRsSTt+M/aDiySHRac86n5fnt76Hhakz0peOY3efJiaAPAgABAKAPAQIAAAABAAAAaq+/lJND7LUI3gMAAAAAAAAB/GQgj9CN8+h6nKKR6li1Snudp05RyxxRBoOJ0VhYzfQICgAAAAAAAAAABvwDUkdCAgEAJvwDUkdCBN1GxJO34z9oOLJIdFpzzqfl+e3voeFqTPSl45jd58mJRN1GxJO34z9oOLJIdFpzzqfl+e3voeFqTPSl45jd58mJoA8CAPRsoL+Jy7Rs/V5jFDq4ik/AJTz1E0H8b7IdyngLR7cMAAEBK+gDAAAAAAAAIlEg3oU2/GUMIeYj4d/R1dK5ThTLhkg7JAhjPOLjNqb215YBCEIBQD/iWL6tgZRxx3vFRbBAwQMghZhxpPw3PikeZuX527+jSiXp1ROxMGOs6OUpPyEQbCBCks3rmCczjuL6UAX2F1gAJvwDTVBDAN1GxJO34z9oOLJIdFpzzqfl+e3voeFqTPSl45jd58mJIPzmC/TaAA3mJ80JFOE5oBCRCAVsk6dL9XtUrUM8YfGGBvwDTVBDAQjkm+LXMSSzLwb8A01QQxAg6wXBZTGshFceO1rQtCoz1eDEfgGcWdvMvHLJlmozjEIG/ANNUEMR/T8BAwAACAAAAAADae7JECXbMJ7Mazf4R9Dc5fuxl0InpewquKUQmEbL55EAA+/B81sk0MMlLR2vRa2xBH5iHHcFqEODBXsG+1bs6TTmAAOtezvL0mQhtxHXmhXxvyyzceb8SuhndZlrpL/Rhga9QgADSuFgqSJ5Y7LPbc8EO1jnAEZzmYF4xP+XNibE6xWde1cAA5MH/zjKED0MuviBwAarTGXVYySWytH7xbA4xGsumqiJAd1GxJO34z9oOLJIdFpzzqfl+e3voeFqTPSl45jd58mJ/OYL9NoADeYnzQkU4TmgEJEIBWyTp0v1e1StQzxh8YYAAzUasPKuHDMchHHg/TTlp2H2QRrbC1b8ZrvejhvnGYHeAAPMIF2MmPxf5tbBE4YD8H3wJ8ZgLULQJzCvRoWPNhZ8ywHkm+LXMSSzLwj8BU9QUkVUASDrBcFlMayEVx47WtC0KjPV4MR+AZxZ28y8csmWajOMQgABBSCrtNM6dm66W+WzONZ7z9EJIfUIk5JRSATxkVKKYX5KpwA=';

  
export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<any>(null);
  const [walletFlowResults, setWalletFlowResults] = useState<any>(null);
  const [runningWalletFlow, setRunningWalletFlow] = useState(false);
  const [account, setAccount] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [keyPair, setKeyPair] = useState<any>(null);

  useEffect(() => {
    // Enable DEBUG logging for rgb-sdk
    configureLogging(LogLevel.DEBUG);
    async function testKeyFunctions() {
      try {
        setLoading(true);
        setError(null);
        const results: any = {
          summary: {
            total: 0,
            passed: 0,
            failed: 0,
          },
        };

        // ========== Test 1: generateKeys ==========
        console.log('=== Testing generateKeys ===');
        try {
          const testnetKeys = await generateKeys('testnet');
          const mainnetKeys = await generateKeys('mainnet');
          const regtestKeys = await generateKeys('regtest');
          
          results.generateKeys = {
            success: true,
            testnet: {
              valid: testnetKeys.xpub.startsWith('tpub') && 
                     testnetKeys.accountXpubVanilla.startsWith('tpub') &&
                     testnetKeys.xpriv.startsWith('tprv') &&
                     testnetKeys.mnemonic.split(' ').length === 12,
            },
            mainnet: {
              valid: mainnetKeys.xpub.startsWith('xpub') && 
                     mainnetKeys.accountXpubVanilla.startsWith('xpub') &&
                     mainnetKeys.xpriv.startsWith('xprv'),
            },
            regtest: {
              valid: regtestKeys.xpub.startsWith('tpub') && 
                     regtestKeys.accountXpubVanilla.startsWith('tpub') &&
                     regtestKeys.xpriv.startsWith('tprv'),
            },
            differentKeys: testnetKeys.mnemonic !== mainnetKeys.mnemonic,
          };
          results.summary.total += 3;
          results.summary.passed += 3;
          console.log('✅ generateKeys tests passed');
        } catch (err: any) {
          results.generateKeys = { success: false, error: err.message };
          results.summary.total += 3;
          results.summary.failed += 3;
          console.error('❌ generateKeys failed:', err);
        }

        // ========== Test 2: deriveKeysFromMnemonic ==========
        console.log('=== Testing deriveKeysFromMnemonic ===');
        try {
          const keys = await deriveKeysFromMnemonic('testnet', testMnemonic);
          const trimmedKeys = await deriveKeysFromMnemonic('testnet', `  ${testMnemonic}  `.trim());
          const mainnetKeys = await deriveKeysFromMnemonic('mainnet', testMnemonic);
          
          results.deriveKeysFromMnemonic = {
            success: true,
            tests: {
              mnemonic: keys.mnemonic === expectedKeys.mnemonic,
              xpub: keys.xpub === expectedKeys.xpub,              
              accountXpubVanilla: keys.accountXpubVanilla === expectedKeys.accountXpubVanilla,
              accountXpubColored: keys.accountXpubColored === expectedKeys.accountXpubColored,
              masterFingerprint: keys.masterFingerprint?.toLowerCase() === expectedKeys.masterFingerprint.toLowerCase(),
              trimmedMnemonic: trimmedKeys.accountXpubVanilla === expectedKeys.accountXpubVanilla,
              differentNetworks: keys.accountXpubVanilla !== mainnetKeys.accountXpubVanilla,
              sameFingerprint: keys.masterFingerprint === mainnetKeys.masterFingerprint,
              deterministic: (await deriveKeysFromMnemonic('testnet', testMnemonic)).xpub === keys.xpub,
            },
          };
          results.summary.total += 9;
          results.summary.passed += Object.values(results.deriveKeysFromMnemonic.tests).filter((v: any) => v === true).length;
          results.summary.failed += Object.values(results.deriveKeysFromMnemonic.tests).filter((v: any) => v === false).length;
          console.log('✅ deriveKeysFromMnemonic tests:', results.deriveKeysFromMnemonic.tests);
        } catch (err: any) {
          results.deriveKeysFromMnemonic = { success: false, error: err.message };
          results.summary.total += 9;
          results.summary.failed += 9;
          console.error('❌ deriveKeysFromMnemonic failed:', err);
        }

        // ========== Test 3: getXprivFromMnemonic ==========
        console.log('=== Testing getXprivFromMnemonic ===');
        try {
          const xpriv = await getXprivFromMnemonic('testnet', testMnemonic);
          const mainnetXpriv = await getXprivFromMnemonic('mainnet', testMnemonic);
          const xpriv2 = await getXprivFromMnemonic('testnet', testMnemonic);
          
          results.getXprivFromMnemonic = {
            success: true,
            tests: {
              hasXpriv: !!xpriv && xpriv.startsWith('tprv'),
              differentNetworks: xpriv !== mainnetXpriv && mainnetXpriv.startsWith('xprv'),
              deterministic: xpriv === xpriv2,
              matchesDeriveKeys: results.deriveKeysFromMnemonic?.success && 
                                 results.deriveKeysFromMnemonic.tests?.xpub ? 
                                 (await getXpubFromXpriv(xpriv, 'testnet')) === expectedKeys.xpub : false,
            },
          };
          results.summary.total += 4;
          results.summary.passed += Object.values(results.getXprivFromMnemonic.tests).filter((v: any) => v === true).length;
          results.summary.failed += Object.values(results.getXprivFromMnemonic.tests).filter((v: any) => v === false).length;
          console.log('✅ getXprivFromMnemonic:', results.getXprivFromMnemonic.tests);
        } catch (err: any) {
          results.getXprivFromMnemonic = { success: false, error: err.message };
          results.summary.total += 4;
          results.summary.failed += 4;
          console.error('❌ getXprivFromMnemonic failed:', err);
        }

        // ========== Test 4: getXpubFromXpriv ==========
        console.log('=== Testing getXpubFromXpriv ===');
        try {
          const testXpriv = results.getXprivFromMnemonic?.success ? 
            await getXprivFromMnemonic('testnet', testMnemonic) : null;
          
          if (testXpriv) {
            const xpub = await getXpubFromXpriv(testXpriv, 'testnet');
            const xpub2 = await getXpubFromXpriv(testXpriv, 'testnet');
            
            results.getXpubFromXpriv = {
              success: true,
              tests: {
                correctXpub: xpub === expectedKeys.xpub,
                deterministic: xpub === xpub2,
                matchesDeriveKeys: results.deriveKeysFromMnemonic?.success && 
                                   results.deriveKeysFromMnemonic.tests?.xpub ? 
                                   xpub === expectedKeys.xpub : false,
              },
            };
            results.summary.total += 3;
            results.summary.passed += Object.values(results.getXpubFromXpriv.tests).filter((v: any) => v === true).length;
            results.summary.failed += Object.values(results.getXpubFromXpriv.tests).filter((v: any) => v === false).length;
            console.log('✅ getXpubFromXpriv:', results.getXpubFromXpriv.tests);
          }
        } catch (err: any) {
          results.getXpubFromXpriv = { success: false, error: err.message };
          results.summary.total += 3;
          results.summary.failed += 3;
          console.error('❌ getXpubFromXpriv failed:', err);
        }

        // ========== Test 5: deriveKeysFromXpriv ==========
        console.log('=== Testing deriveKeysFromXpriv ===');
        try {
          const testXpriv = results.getXprivFromMnemonic?.success ? 
            await getXprivFromMnemonic('testnet', testMnemonic) : null;
          
          if (testXpriv) {
            const keysFromXpriv = await deriveKeysFromXpriv(testXpriv as string);
            const keysFromMnemonic = results.deriveKeysFromMnemonic?.success ? 
              await deriveKeysFromMnemonic('testnet', testMnemonic) : null;
            const keysFromXpriv2 = await deriveKeysFromXpriv(testXpriv as string);
            
            results.deriveKeysFromXpriv = {
              success: true,
              tests: {
                xpub: keysFromXpriv.xpub === expectedKeys.xpub,
                accountXpubVanilla: keysFromXpriv.accountXpubVanilla === expectedKeys.accountXpubVanilla,
                accountXpubColored: keysFromXpriv.accountXpubColored === expectedKeys.accountXpubColored,
                masterFingerprint: keysFromXpriv.masterFingerprint?.toLowerCase() === expectedKeys.masterFingerprint.toLowerCase(),
                emptyMnemonic: keysFromXpriv.mnemonic === '',
                matchesMnemonicKeys: keysFromMnemonic ? 
                  keysFromXpriv.xpub === keysFromMnemonic.xpub &&
                  keysFromXpriv.accountXpubVanilla === keysFromMnemonic.accountXpubVanilla : false,
                deterministic: keysFromXpriv.xpub === keysFromXpriv2.xpub,
              }
            };
            results.summary.total += 7;
            results.summary.passed += Object.values(results.deriveKeysFromXpriv.tests).filter((v: any) => v === true).length;
            results.summary.failed += Object.values(results.deriveKeysFromXpriv.tests).filter((v: any) => v === false).length;
            console.log('✅ deriveKeysFromXpriv tests:', results.deriveKeysFromXpriv.tests);
          }
        } catch (err: any) {
          results.deriveKeysFromXpriv = { success: false, error: err.message };
          results.summary.total += 7;
          results.summary.failed += 7;
          console.error('❌ deriveKeysFromXpriv failed:', err);
        }

        // ========== Test 6: deriveKeysFromSeed ==========
        console.log('=== Testing deriveKeysFromSeed ===');
        try {
          const { mnemonicToSeedSync } = require('@scure/bip39');
          const seedBuffer = Buffer.from(mnemonicToSeedSync(testMnemonic));
          const seedHex = seedBuffer.toString('hex');
          const seedArray = new Uint8Array(seedBuffer);
          
          const keysFromHex = await deriveKeysFromSeed('testnet', seedHex);
          const keysFromArray = await deriveKeysFromSeed('testnet', seedArray);
          
          results.deriveKeysFromSeed = {
            success: true,
            tests: {
              hexSeed: keysFromHex.xpub === expectedKeys.xpub &&
                       keysFromHex.accountXpubVanilla === expectedKeys.accountXpubVanilla,
              arraySeed: keysFromArray.xpub === expectedKeys.xpub &&
                         keysFromArray.accountXpubVanilla === expectedKeys.accountXpubVanilla,
              emptyMnemonic: keysFromHex.mnemonic === '' && keysFromArray.mnemonic === '',
              sameResults: keysFromHex.xpub === keysFromArray.xpub,
            },
          };
          results.summary.total += 4;
          results.summary.passed += Object.values(results.deriveKeysFromSeed.tests).filter((v: any) => v === true).length;
          results.summary.failed += Object.values(results.deriveKeysFromSeed.tests).filter((v: any) => v === false).length;
          console.log('✅ deriveKeysFromSeed:', results.deriveKeysFromSeed.tests);
        } catch (err: any) {
          results.deriveKeysFromSeed = { success: false, error: err.message };
          results.summary.total += 4;
          results.summary.failed += 4;
          console.error('❌ deriveKeysFromSeed failed:', err);
        }

        // ========== Test 7: restoreKeys (alias) ==========
        console.log('=== Testing restoreKeys ===');
        try {
          const restoredKeys = await restoreKeys('testnet', testMnemonic);
          
          results.restoreKeys = {
            success: true,
            tests: {
              worksAsAlias: restoredKeys.mnemonic === testMnemonic &&
                            restoredKeys.accountXpubVanilla === expectedKeys.accountXpubVanilla &&
                            restoredKeys.masterFingerprint?.toLowerCase() === expectedKeys.masterFingerprint?.toLowerCase(),
            },
          };
          results.summary.total += 1;
          results.summary.passed += results.restoreKeys.tests.worksAsAlias ? 1 : 0;
          results.summary.failed += results.restoreKeys.tests.worksAsAlias ? 0 : 1;
          console.log('✅ restoreKeys:', results.restoreKeys.tests);
        } catch (err: any) {
          results.restoreKeys = { success: false, error: err.message };
          results.summary.total += 1;
          results.summary.failed += 1;
          console.error('❌ restoreKeys failed:', err);
        }

        // ========== Test 8: Error Handling ==========
        console.log('=== Testing Error Handling ===');
        try {
          let errorTests: any = {};
          
          // Test empty mnemonic
          try {
            await deriveKeysFromMnemonic('testnet', '');
            errorTests.emptyMnemonic = false;
          } catch (err: any) {
            errorTests.emptyMnemonic = err instanceof ValidationError && err.message.includes('mnemonic');
          }
          
          // Test invalid mnemonic
          try {
            await deriveKeysFromMnemonic('testnet', 'invalid mnemonic phrase');
            errorTests.invalidMnemonic = false;
          } catch (err: any) {
            errorTests.invalidMnemonic = err instanceof ValidationError;
          }
          
          // Test empty xpriv
          try {
            await deriveKeysFromXpriv('testnet', '');
            errorTests.emptyXpriv = false;
          } catch (err: any) {
            errorTests.emptyXpriv = err instanceof ValidationError && err.message.includes('xpriv');
          }
          
          results.errorHandling = {
            success: true,
            tests: errorTests,
          };
          results.summary.total += 3;
          results.summary.passed += Object.values(errorTests).filter((v: any) => v === true).length;
          results.summary.failed += Object.values(errorTests).filter((v: any) => v === false).length;
          console.log('✅ Error Handling:', results.errorHandling.tests);
        } catch (err: any) {
          results.errorHandling = { success: false, error: err.message };
          results.summary.total += 3;
          results.summary.failed += 3;
          console.error('❌ Error Handling tests failed:', err);
        }

        console.log('=== Testing signPsbt ===');
        try {
          // Test signing UTXO creation PSBT
          const signedUtxoPsbt = await signPsbt(testMnemonic, utxoUnsignedPsbt, 'testnet');
          console.log('Signed UTXO PSBT:', signedUtxoPsbt);
          
          results.signPsbt = {
            success: true,
            utxoPsbtSigned: signedUtxoPsbt === utxoSignedPsbt,
            utxoPsbtLength: signedUtxoPsbt?.length || 0,
          };
          console.log('✅ signPsbt UTXO test:', results.signPsbt);

          // Test signing Send begin PSBT
          const signedSendPsbt = await signPsbt(testMnemonic, sendUnsignedPsbt, 'testnet');
          console.log('Signed Send PSBT:', signedSendPsbt);
          
          results.signPsbt.sendPsbtSigned = signedSendPsbt === sendSignedPsbt;
          results.signPsbt.sendPsbtLength = signedSendPsbt?.length || 0;
          console.log('✅ signPsbt Send test:', results.signPsbt.sendPsbtSigned);
        } catch (signError: any) {
          console.error('❌ signPsbt failed:', signError);
          results.signPsbt = {
            success: false,
            error: signError?.message || 'Unknown error',
          };
        }

        setTestResults(results);
        console.log('=== All Tests Complete ===');
        console.log('Full results:', JSON.stringify(results, null, 2));

      } catch (err) {
        console.error('Error testing key functions:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setLoading(false);
      }
    }

    testKeyFunctions();
  }, []);

  // Run wallet flow separately (can be triggered manually or automatically)
  useEffect(() => {
    // Uncomment to run wallet flow automatically on mount
    // runWalletFlowTest();
  }, []);

  async function runWalletFlowTest() {
    try {
      setRunningWalletFlow(true);
      setError(null);
      console.log('=== Starting Wallet Flow Test ===');
      const flowResults = await runWalletFlow();
      setWalletFlowResults(flowResults);
      console.log('=== Wallet Flow Complete ===');
      console.log('Flow results:', JSON.stringify(flowResults, null, 2));
    } catch (err) {
      console.error('Error in wallet flow:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setRunningWalletFlow(false);
    }
  }

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">RGB Wallet</ThemedText>
        <HelloWave />
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Wallet Status</ThemedText>
        {loading && <ThemedText>Loading wallet...</ThemedText>}
        {error && (
          <ThemedView style={styles.errorContainer}>
            <ThemedText style={styles.errorText}>Error: {error}</ThemedText>
          </ThemedView>
        )}
        {!loading && !error && testResults && (
          <>
            <ThemedView style={styles.infoContainer}>
              <ThemedText type="defaultSemiBold">deriveKeysFromMnemonic:</ThemedText>
              <ThemedText style={styles.monoText}>
                {JSON.stringify(testResults.deriveKeysFromMnemonic?.tests, null, 2)}
              </ThemedText>
            </ThemedView>
            <ThemedView style={styles.infoContainer}>
              <ThemedText type="defaultSemiBold">getXprivFromMnemonic:</ThemedText>
              <ThemedText style={styles.monoText}>
                {testResults.getXprivFromMnemonic?.success ? 
                  JSON.stringify(testResults.getXprivFromMnemonic.tests, null, 2) :
                  `❌ Failed: ${testResults.getXprivFromMnemonic?.error}`}
              </ThemedText>
            </ThemedView>
            
            {testResults.getXpubFromXpriv && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">getXpubFromXpriv:</ThemedText>
                <ThemedText style={styles.monoText}>
                  {testResults.getXpubFromXpriv.success ? 
                    JSON.stringify(testResults.getXpubFromXpriv.tests, null, 2) :
                    `❌ Failed: ${testResults.getXpubFromXpriv.error}`}
                </ThemedText>
              </ThemedView>
            )}
            {testResults.deriveKeysFromXpriv && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">deriveKeysFromXpriv:</ThemedText>
                <ThemedText style={styles.monoText}>
                  {testResults.deriveKeysFromXpriv.success ? 
                    JSON.stringify(testResults.deriveKeysFromXpriv.tests, null, 2) :
                    `❌ Failed: ${testResults.deriveKeysFromXpriv.error}`}
                </ThemedText>
              </ThemedView>
            )}
            
            {testResults.deriveKeysFromSeed && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">deriveKeysFromSeed:</ThemedText>
                <ThemedText style={styles.monoText}>
                  {testResults.deriveKeysFromSeed.success ? 
                    JSON.stringify(testResults.deriveKeysFromSeed.tests, null, 2) :
                    `❌ Failed: ${testResults.deriveKeysFromSeed.error}`}
                </ThemedText>
              </ThemedView>
            )}
            
            {testResults.restoreKeys && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">restoreKeys:</ThemedText>
                <ThemedText style={styles.monoText}>
                  {testResults.restoreKeys.success ? 
                    JSON.stringify(testResults.restoreKeys.tests, null, 2) :
                    `❌ Failed: ${testResults.restoreKeys.error}`}
                </ThemedText>
              </ThemedView>
            )}
            
            {testResults.errorHandling && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">Error Handling:</ThemedText>
                <ThemedText style={styles.monoText}>
                  {testResults.errorHandling.success ? 
                    JSON.stringify(testResults.errorHandling.tests, null, 2) :
                    `❌ Failed: ${testResults.errorHandling.error}`}
                </ThemedText>
              </ThemedView>
            )}
            {testResults.signPsbt && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">signPsbt:</ThemedText>
                {testResults.signPsbt.success ? (
                  <ThemedText style={styles.monoText}>
                    ✅ UTXO PSBT: {testResults.signPsbt.utxoPsbtSigned ? 'Matches expected' : 'Does not match'}
                    {testResults.signPsbt.sendPsbtSigned !== undefined && (
                      `\n✅ Send PSBT: ${testResults.signPsbt.sendPsbtSigned ? 'Matches expected' : 'Does not match'}`
                    )}
                  </ThemedText>
                ) : (
                  <ThemedText style={[styles.monoText, styles.errorText]}>
                    ❌ Failed: {testResults.signPsbt.error}
                  </ThemedText>
                )}
              </ThemedView>
            )}
            <ThemedView style={styles.infoContainer}>
              <ThemedText type="defaultSemiBold">Full Results:</ThemedText>
              <ThemedText style={styles.monoText} numberOfLines={10}>
                {JSON.stringify(testResults, null, 2)}
              </ThemedText>
            </ThemedView>
          </>
        )}
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Wallet Flow Test</ThemedText>
        <ThemedView style={styles.infoContainer}>
          <ThemedText style={styles.monoText} numberOfLines={3}>
            {Platform.OS === 'android' 
              ? 'Using: http://10.0.2.2:8000 (Android emulator)\nFor physical device, use your PC IP'
              : Platform.OS === 'ios'
              ? 'Using: http://127.0.0.1:8000 (iOS simulator)\nFor physical device, use your Mac IP'
              : 'Using: http://127.0.0.1:8000'}
          </ThemedText>
        </ThemedView>
        {runningWalletFlow && <ThemedText>Running wallet flow...</ThemedText>}
        {!runningWalletFlow && !walletFlowResults && (
          <ThemedView style={styles.infoContainer}>
            <ThemedText>Click button below to run full wallet flow test</ThemedText>
            <TouchableOpacity 
              style={styles.button}
              onPress={runWalletFlowTest}
            >
              <ThemedText style={styles.buttonText}>
                ▶ Run Wallet Flow
              </ThemedText>
            </TouchableOpacity>
          </ThemedView>
        )}
        {walletFlowResults && (
          <>
            <ThemedView style={styles.infoContainer}>
              <ThemedText type="defaultSemiBold">Flow Status:</ThemedText>
              <ThemedText style={styles.monoText}>
                {walletFlowResults.success ? '✅ Completed' : '❌ Failed'}
                {walletFlowResults.error && (
                  `\nError: ${walletFlowResults.error.message}`
                )}
              </ThemedText>
            </ThemedView>
            <ThemedView style={styles.infoContainer}>
              <ThemedText type="defaultSemiBold">Steps Completed:</ThemedText>
              <ThemedText style={styles.monoText} numberOfLines={15}>
                {walletFlowResults.steps?.map((step: any, idx: number) => (
                  `${idx + 1}. ${step.step}: ${step.status === 'success' ? '✅' : step.status === 'running' ? '⏳' : '❌'}\n`
                )).join('')}
              </ThemedText>
            </ThemedView>
            {walletFlowResults.assetId && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">Issued Asset ID:</ThemedText>
                <ThemedText style={styles.monoText} numberOfLines={2}>
                  {walletFlowResults.assetId}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.receiverAssetBalance && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">Receiver Asset Balance:</ThemedText>
                <ThemedText style={styles.monoText} numberOfLines={5}>
                  {JSON.stringify(walletFlowResults.receiverAssetBalance, null, 2)}
                </ThemedText>
              </ThemedView>
            )}
          </>
        )}
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Debug Info</ThemedText>
        <ThemedText>
          Check the console logs for detailed account information.
          {Platform.select({
            ios: ' Press cmd + d to open developer tools.',
            android: ' Press cmd + m to open developer tools.',
            web: ' Press F12 to open developer tools.',
          })}
        </ThemedText>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
  infoContainer: {
    gap: 4,
    marginTop: 8,
  },
  monoText: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      web: 'monospace',
    }),
    fontSize: 12,
  },
  errorContainer: {
    padding: 12,
    backgroundColor: '#ffebee',
    borderRadius: 8,
    marginTop: 8,
  },
  errorText: {
    color: '#c62828',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
});
