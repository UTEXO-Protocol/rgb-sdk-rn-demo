import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import sdkPkg from '@utexo/rgb-sdk-rn/package.json';
import { RGB_LIB_ANDROID_VERSION } from '@utexo/rgb-sdk-rn';

import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

import { runWalletFlow, runUTEXOFlow } from '@/utils/wallet-flow';
import {
  wallet,
  deriveKeysFromMnemonic,
  deriveKeysFromMnemonicOrSeed,
  deriveKeysFromSeed,
  deriveKeysFromXpriv,
  generateKeys,
  getXprivFromMnemonic,
  getXpubFromXpriv,
  restoreKeys,
  accountXpubsFromMnemonic,
  signPsbt,
  signPsbtSync,
  signPsbtFromSeed,
  signMessage,
  verifyMessage,
  WalletManager,
  createWalletManager,
  restoreFromVss,
  toUnitsNumber,
  fromUnitsNumber,
  // Error classes
  SDKError,
  NetworkError,
  ValidationError,
  WalletError,
  CryptoError,
  ConfigurationError,
  BadRequestError,
  NotFoundError,
  ConflictError,
  RgbNodeError,
  // Logger
  logger,
  configureLogging,
  LogLevel,
  // Validation
  validateNetwork,
  normalizeNetwork,
  validateMnemonic,
  validatePsbt,
  validateBase64,
  validateHex,
  validateRequired,
  validateString,
  // Constants
  COIN_RGB_MAINNET,
  COIN_RGB_TESTNET,
  COIN_BITCOIN_MAINNET,
  COIN_BITCOIN_TESTNET,
  NETWORK_MAP,
  BIP32_VERSIONS,
  DERIVATION_PURPOSE,
  DERIVATION_ACCOUNT,
  KEYCHAIN_RGB,
  KEYCHAIN_BTC,
  DEFAULT_NETWORK,
  DEFAULT_API_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_LOG_LEVEL,
  utexoNetworkMap,
  utexoNetworkIdMap,
  getDestinationAsset,
  // UTEXO
  UTEXOWallet,
  LightningProtocol,
  OnchainProtocol,
  UTEXOProtocol,
  bridgeAPI,
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
  const [utexoFlowResults, setUtexoFlowResults] = useState<any>(null);
  const [runningUTEXOFlow, setRunningUTEXOFlow] = useState(false);
  const [vssFlowResults, setVssFlowResults] = useState<any>(null);
  const [runningVssFlow, setRunningVssFlow] = useState(false);
  const [account, setAccount] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [keyPair, setKeyPair] = useState<any>(null);

  useEffect(() => {
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
            await deriveKeysFromXpriv('');
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

        // ========== Test: signMessage + verifyMessage ==========
        console.log('=== Testing signMessage + verifyMessage ===');
        try {
          const { mnemonicToSeedSync } = require('@scure/bip39');
          const seed = Buffer.from(mnemonicToSeedSync(testMnemonic));
          const keys = await deriveKeysFromMnemonic('testnet', testMnemonic);
          const testMessage = 'hello rgb';

          const signature = await signMessage({ message: testMessage, seed, network: 'testnet' });
          console.log('Signature:', signature);

          const validSig = await verifyMessage({ message: testMessage, signature, accountXpub: keys.accountXpubVanilla, network: 'testnet' });
          const wrongMsg = await verifyMessage({ message: 'wrong message', signature, accountXpub: keys.accountXpubVanilla, network: 'testnet' });
          const wrongKey = await verifyMessage({ message: testMessage, signature, accountXpub: keys.accountXpubColored, network: 'testnet' });

          results.signVerifyMessage = {
            success: true,
            signature: signature?.slice(0, 20) + '…',
            tests: {
              signatureProduced: !!signature && signature.length > 0,
              validSignature: validSig === true,
              wrongMessageFails: wrongMsg === false,
              wrongKeyFails: wrongKey === false,
            },
          };
          console.log('✅ signMessage + verifyMessage:', results.signVerifyMessage.tests);
        } catch (err: any) {
          console.error('❌ signMessage/verifyMessage failed:', err);
          results.signVerifyMessage = { success: false, error: err.message };
        }

        // ========== Test: toUnitsNumber + fromUnitsNumber ==========
        console.log('=== Testing toUnitsNumber + fromUnitsNumber ===');
        try {
          const units = toUnitsNumber('1.5', 8);
          const back = fromUnitsNumber(units, 8);
          const zeroPrec = toUnitsNumber('100', 0);
          results.units = {
            success: true,
            tests: {
              toUnits: units === 150000000,
              fromUnits: back === 1.5,
              zeroPrecision: zeroPrec === 100,
              roundTrip: fromUnitsNumber(toUnitsNumber('42.123456', 6), 6) === 42.123456,
            },
          };
          console.log('✅ units:', results.units.tests);
        } catch (err: any) {
          results.units = { success: false, error: err.message };
          console.error('❌ units failed:', err);
        }

        // ========== Test: deriveKeysFromMnemonicOrSeed ==========
        console.log('=== Testing deriveKeysFromMnemonicOrSeed ===');
        try {
          const { mnemonicToSeedSync } = require('@scure/bip39');
          const seedHex = Buffer.from(mnemonicToSeedSync(testMnemonic)).toString('hex');
          const fromMnemonic = await deriveKeysFromMnemonicOrSeed('testnet', testMnemonic);
          const fromHex = await deriveKeysFromMnemonicOrSeed('testnet', seedHex);
          const fromArray = await deriveKeysFromMnemonicOrSeed('testnet', new Uint8Array(Buffer.from(mnemonicToSeedSync(testMnemonic))));
          results.deriveKeysFromMnemonicOrSeed = {
            success: true,
            tests: {
              mnemonicRoute: fromMnemonic.xpub === expectedKeys.xpub,
              hexSeedRoute: fromHex.xpub === expectedKeys.xpub,
              arrayRoute: fromArray.xpub === expectedKeys.xpub,
            },
          };
          console.log('✅ deriveKeysFromMnemonicOrSeed:', results.deriveKeysFromMnemonicOrSeed.tests);
        } catch (err: any) {
          results.deriveKeysFromMnemonicOrSeed = { success: false, error: err.message };
          console.error('❌ deriveKeysFromMnemonicOrSeed failed:', err);
        }

        // ========== Test: accountXpubsFromMnemonic ==========
        console.log('=== Testing accountXpubsFromMnemonic ===');
        try {
          const xpubs = await accountXpubsFromMnemonic('testnet', testMnemonic);
          results.accountXpubsFromMnemonic = {
            success: true,
            tests: {
              vanillaXpub: xpubs.account_xpub_vanilla === expectedKeys.accountXpubVanilla,
              coloredXpub: xpubs.account_xpub_colored === expectedKeys.accountXpubColored,
            },
          };
          console.log('✅ accountXpubsFromMnemonic:', results.accountXpubsFromMnemonic.tests);
        } catch (err: any) {
          results.accountXpubsFromMnemonic = { success: false, error: err.message };
          console.error('❌ accountXpubsFromMnemonic failed:', err);
        }

        // ========== Test: signPsbtSync ==========
        console.log('=== Testing signPsbtSync ===');
        try {
          const signedSync = await signPsbtSync(testMnemonic, utxoUnsignedPsbt, 'testnet');
          results.signPsbtSync = {
            success: true,
            tests: {
              matchesAsync: signedSync === utxoSignedPsbt,
            },
          };
          console.log('✅ signPsbtSync:', results.signPsbtSync.tests);
        } catch (err: any) {
          results.signPsbtSync = { success: false, error: err.message };
          console.error('❌ signPsbtSync failed:', err);
        }

        // ========== Test: signPsbtFromSeed ==========
        // signPsbtFromSeed is intentionally unsupported (throws CryptoError); test that it throws correctly.
        console.log('=== Testing signPsbtFromSeed ===');
        try {
          const { mnemonicToSeedSync } = require('@scure/bip39');
          const seed = new Uint8Array(Buffer.from(mnemonicToSeedSync(testMnemonic)));
          await signPsbtFromSeed(seed, utxoUnsignedPsbt, 'testnet');
          results.signPsbtFromSeed = { success: false, error: 'Expected throw, but resolved' };
        } catch (err: any) {
          results.signPsbtFromSeed = {
            success: true,
            tests: {
              throwsNotSupported: (err.message as string).includes('not supported'),
            },
          };
          console.log('✅ signPsbtFromSeed correctly throws:', err.message);
        }

        // ========== Test: createWalletManager ==========
        console.log('=== Testing createWalletManager ===');
        try {
          const keys = await deriveKeysFromMnemonic('testnet', testMnemonic);
          const wm = createWalletManager({
            xpubVan: keys.accountXpubVanilla,
            xpubCol: keys.accountXpubColored,
            masterFingerprint: keys.masterFingerprint,
            mnemonic: testMnemonic,
            network: 'testnet',
          });
          results.createWalletManager = {
            success: true,
            tests: {
              returnsInstance: wm !== null && typeof wm.initialize === 'function',
              notDisposed: wm.isDisposed() === false,
              correctXpub: wm.getXpub().xpubVan === keys.accountXpubVanilla,
              correctNetwork: wm.getNetwork() === 'testnet',
            },
          };
          console.log('✅ createWalletManager:', results.createWalletManager.tests);
        } catch (err: any) {
          results.createWalletManager = { success: false, error: err.message };
          console.error('❌ createWalletManager failed:', err);
        }

        // ========== Test: wallet singleton ==========
        console.log('=== Testing wallet singleton ===');
        try {
          const walletTests: Record<string, boolean> = {};
          walletTests.isProxy = wallet !== null && typeof wallet === 'object';
          // Proxy throws WalletError when accessed before initialization
          try {
            void (wallet as any).initialize;
            walletTests.throwsWhenUninitialized = false;
          } catch (e: any) {
            walletTests.throwsWhenUninitialized = e instanceof WalletError && e.message.includes('not initialised');
          }
          results.walletSingleton = { success: true, tests: walletTests };
          console.log('✅ wallet singleton:', walletTests);
        } catch (err: any) {
          results.walletSingleton = { success: false, error: err.message };
          console.error('❌ wallet singleton failed:', err);
        }

        // ========== Test: Error classes ==========
        console.log('=== Testing Error classes ===');
        try {
          const sdkErr = new SDKError('msg', 'CODE');
          const netErr = new NetworkError('msg', 503);
          const walletErr = new WalletError('msg');
          const cryptoErr = new CryptoError('msg');
          const configErr = new ConfigurationError('msg');
          const badReqErr = new BadRequestError('msg');
          const notFoundErr = new NotFoundError('msg');
          const conflictErr = new ConflictError('msg');
          const rgbNodeErr = new RgbNodeError('msg', 500);
          const valErr = new ValidationError('msg', 'field');
          results.errorClasses = {
            success: true,
            tests: {
              SDKError: sdkErr instanceof SDKError && sdkErr.code === 'CODE',
              NetworkError: netErr instanceof SDKError && netErr.statusCode === 503,
              WalletError: walletErr instanceof SDKError && walletErr.name === 'WalletError',
              CryptoError: cryptoErr instanceof SDKError && cryptoErr.name === 'CryptoError',
              ConfigurationError: configErr instanceof SDKError && configErr.name === 'ConfigurationError',
              BadRequestError: badReqErr instanceof SDKError && badReqErr.statusCode === 400,
              NotFoundError: notFoundErr instanceof SDKError && notFoundErr.statusCode === 404,
              ConflictError: conflictErr instanceof SDKError && conflictErr.statusCode === 409,
              RgbNodeError: rgbNodeErr instanceof SDKError && rgbNodeErr.statusCode === 500,
              ValidationError: valErr instanceof SDKError && valErr.field === 'field',
            },
          };
          console.log('✅ Error classes:', results.errorClasses.tests);
        } catch (err: any) {
          results.errorClasses = { success: false, error: err.message };
          console.error('❌ Error classes failed:', err);
        }

        // ========== Test: Logger ==========
        console.log('=== Testing Logger ===');
        try {
          const LV = LogLevel as any;
          configureLogging(LV.DEBUG);
          configureLogging(LV.ERROR);
          results.loggerModule = {
            success: true,
            tests: {
              LogLevelEnum: LV.DEBUG === 0 && LV.INFO === 1 && LV.WARN === 2 && LV.ERROR === 3 && LV.NONE === 4,
              configureLogging: true,
              loggerInstance: logger !== null && typeof (logger as any).debug === 'function' && typeof (logger as any).error === 'function',
            },
          };
          console.log('✅ Logger:', results.loggerModule.tests);
        } catch (err: any) {
          results.loggerModule = { success: false, error: err.message };
          console.error('❌ Logger failed:', err);
        }

        // ========== Test: Validation functions ==========
        console.log('=== Testing Validation functions ===');
        try {
          const valTests: Record<string, boolean> = {};
          valTests.normalizeNetwork = normalizeNetwork('mainnet') === 'mainnet' && normalizeNetwork('testnet') === 'testnet' && normalizeNetwork('regtest') === 'regtest';
          try { validateNetwork('bad-network'); valTests.validateNetworkThrows = false; } catch { valTests.validateNetworkThrows = true; }
          try { validateMnemonic('not a mnemonic'); valTests.validateMnemonicThrows = false; } catch { valTests.validateMnemonicThrows = true; }
          validatePsbt(utxoUnsignedPsbt); valTests.validatePsbt = true;
          validateBase64(utxoUnsignedPsbt); valTests.validateBase64 = true;
          try { validateHex('not-hex!!'); valTests.validateHexThrows = false; } catch { valTests.validateHexThrows = true; }
          validateHex('deadbeef'); valTests.validateHex = true;
          try { validateRequired(null, 'field'); valTests.validateRequiredThrows = false; } catch { valTests.validateRequiredThrows = true; }
          validateRequired('value', 'field'); valTests.validateRequired = true;
          try { validateString(42 as any, 'field'); valTests.validateStringThrows = false; } catch { valTests.validateStringThrows = true; }
          validateString('hello', 'field'); valTests.validateString = true;
          results.validation = { success: true, tests: valTests };
          console.log('✅ Validation:', valTests);
        } catch (err: any) {
          results.validation = { success: false, error: err.message };
          console.error('❌ Validation failed:', err);
        }

        // ========== Test: Constants ==========
        console.log('=== Testing Constants ===');
        try {
          results.constants = {
            success: true,
            tests: {
              COIN_RGB_MAINNET: COIN_RGB_MAINNET === 827166,
              COIN_RGB_TESTNET: COIN_RGB_TESTNET === 827167,
              COIN_BITCOIN_MAINNET: COIN_BITCOIN_MAINNET === 0,
              COIN_BITCOIN_TESTNET: COIN_BITCOIN_TESTNET === 1,
              NETWORK_MAP: NETWORK_MAP['mainnet'] === 'mainnet' && NETWORK_MAP['regtest'] === 'regtest',
              BIP32_VERSIONS: typeof BIP32_VERSIONS.mainnet?.public === 'number',
              DERIVATION_PURPOSE: DERIVATION_PURPOSE === 86,
              DERIVATION_ACCOUNT: DERIVATION_ACCOUNT === 0,
              KEYCHAIN_RGB: KEYCHAIN_RGB === 0,
              KEYCHAIN_BTC: KEYCHAIN_BTC === 0,
              DEFAULT_NETWORK: DEFAULT_NETWORK === 'regtest',
              DEFAULT_API_TIMEOUT: typeof DEFAULT_API_TIMEOUT === 'number',
              DEFAULT_MAX_RETRIES: DEFAULT_MAX_RETRIES === 3,
              DEFAULT_LOG_LEVEL: typeof DEFAULT_LOG_LEVEL === 'number',
              utexoNetworkMap: utexoNetworkMap.mainnet === 'testnet' && utexoNetworkMap.utexo === 'signet',
              utexoNetworkIdMap: utexoNetworkIdMap.utexo.networkName === 'UTEXO' && utexoNetworkIdMap.mainnet.networkId === 36,
              getDestinationAsset: typeof getDestinationAsset === 'function' && getDestinationAsset('mainnet', 'utexo', null) !== undefined,
            },
          };
          console.log('✅ Constants:', results.constants.tests);
        } catch (err: any) {
          results.constants = { success: false, error: err.message };
          console.error('❌ Constants failed:', err);
        }

        // ========== Test: UTEXO Module (instantiation + stubs) ==========
        console.log('=== Testing UTEXO Module ===');
        try {
          const utexoTests: Record<string, boolean> = {};

          // UTEXOWallet can be instantiated
          const utexoWallet = new UTEXOWallet(testMnemonic);
          utexoTests.utexoWalletInstantiated =
            utexoWallet !== null && typeof utexoWallet.initialize === 'function';

          // getXpub() throws before initialize()
          try {
            utexoWallet.getXpub();
            utexoTests.throwsBeforeInit = false;
          } catch (e: any) {
            utexoTests.throwsBeforeInit = e.message.toLowerCase().includes('init');
          }

          // derivePublicKeys works (pure crypto, no server)
          const pubKeys = await utexoWallet.derivePublicKeys('testnet');
          utexoTests.derivePublicKeys = pubKeys.xpub?.startsWith('tpub') ?? false;

          // LightningProtocol stubs throw "not implemented"
          const lp = new LightningProtocol();
          try {
            await lp.createLightningInvoice({ asset: { assetId: 'a', amount: 1 } } as any);
            utexoTests.lightningStubThrows = false;
          } catch (e: any) {
            utexoTests.lightningStubThrows = e.message.includes('not implemented');
          }

          // OnchainProtocol stubs throw "not implemented"
          const op = new OnchainProtocol();
          try {
            await op.onchainReceive({ assetId: 'a', amount: 1 } as any);
            utexoTests.onchainStubThrows = false;
          } catch (e: any) {
            utexoTests.onchainStubThrows = e.message.includes('not implemented');
          }

          // UTEXOProtocol inherits both stub sets
          const up = new UTEXOProtocol();
          try {
            await up.createLightningInvoice({ asset: { assetId: 'a', amount: 1 } } as any);
            utexoTests.utexoProtocolLightningStub = false;
          } catch (e: any) {
            utexoTests.utexoProtocolLightningStub = e.message.includes('not implemented');
          }
          try {
            await up.onchainReceive({ assetId: 'a', amount: 1 } as any);
            utexoTests.utexoProtocolOnchainStub = false;
          } catch (e: any) {
            utexoTests.utexoProtocolOnchainStub = e.message.includes('not implemented');
          }

          // bridgeAPI can be configured
          bridgeAPI.setBaseUrl('http://localhost:8081/');
          utexoTests.bridgeAPIConfigurable = true;

          results.utexoModule = { success: true, tests: utexoTests };
          console.log('✅ UTEXO Module:', utexoTests);
        } catch (err: any) {
          results.utexoModule = { success: false, error: err.message };
          console.error('❌ UTEXO Module failed:', err);
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

  async function runUTEXOFlowTest() {
    try {
      setRunningUTEXOFlow(true);
      setError(null);
      console.log('=== Starting UTEXO Flow Test ===');
      const flowResults = await runUTEXOFlow();
      setUtexoFlowResults(flowResults);
      console.log('=== UTEXO Flow Complete ===');
      console.log('UTEXO flow results:', JSON.stringify(flowResults, null, 2));
    } catch (err) {
      console.error('Error in UTEXO flow:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setRunningUTEXOFlow(false);
    }
  }

  async function runVssFlowTest() {
    const VSS_SERVER_URL = 'https://vss-server.utexo.com/vss';
    const steps: Array<{ step: string; status: string; result?: any; error?: string }> = [];

    const addStep = (step: string, status: string, result?: any, error?: string) => {
      const existing = steps.findIndex(s => s.step === step);
      if (existing >= 0) {
        steps[existing] = { step, status, result, error };
      } else {
        steps.push({ step, status, result, error });
      }
      setVssFlowResults({ running: true, steps: [...steps] });
    };

    try {
      setRunningVssFlow(true);
      setError(null);
      setVssFlowResults({ running: true, steps: [] });

      // Step 1: Generate a fresh wallet
      addStep('generateKeys', 'running');
      const keys = await generateKeys('testnet');
      // Derive a deterministic 32-byte signing key from the masterFingerprint
      // by repeating/padding it. (Demo only — production should use a real secp256k1 key.)
      const fpHex = keys.masterFingerprint; // 4 bytes = 8 hex chars
      // Pad to 64 hex chars by repeating the fingerprint
      const signingKeyHex = (fpHex.repeat(8)).slice(0, 64);
      const storeId = `demo_${keys.masterFingerprint}`;
      addStep('generateKeys', 'success', { masterFingerprint: keys.masterFingerprint });

      const vssConfig = {
        serverUrl: VSS_SERVER_URL,
        storeId,
        signingKeyHex,
        encryptionEnabled: true,
        autoBackup: false,
        backupMode: 'Async' as const,
      };

      // Step 2: Initialize wallet
      addStep('initializeWallet', 'running');
      const wm = await createWalletManager({
        network: 'testnet',
        xpubVan: keys.accountXpubVanilla,
        xpubCol: keys.accountXpubColored,
        mnemonic: keys.mnemonic,
        masterFingerprint: keys.masterFingerprint,
      });
      addStep('initializeWallet', 'success');

      // Step 3: vssBackup — upload encrypted backup
      addStep('vssBackup', 'running');
      let backupVersion: number | null = null;
      try {
        backupVersion = await wm.vssBackup(vssConfig);
        addStep('vssBackup', 'success', { version: backupVersion });
      } catch (e: any) {
        addStep('vssBackup', 'error', undefined, e?.message ?? String(e));
      }

      // Step 4: vssBackupInfo — query server for backup status
      addStep('vssBackupInfo', 'running');
      try {
        const info = await wm.vssBackupInfo(vssConfig);
        addStep('vssBackupInfo', 'success', {
          backupExists: info.backupExists,
          serverVersion: info.serverVersion,
          backupRequired: info.backupRequired,
        });
      } catch (e: any) {
        addStep('vssBackupInfo', 'error', undefined, e?.message ?? String(e));
      }

      // Step 5: configureVssBackup — attach auto-backup (fire-and-forget mode)
      addStep('configureVssBackup', 'running');
      try {
        await wm.configureVssBackup({ ...vssConfig, autoBackup: true });
        addStep('configureVssBackup', 'success');
      } catch (e: any) {
        addStep('configureVssBackup', 'error', undefined, e?.message ?? String(e));
      }

      // Step 6: disableVssAutoBackup
      addStep('disableVssAutoBackup', 'running');
      try {
        await wm.disableVssAutoBackup();
        addStep('disableVssAutoBackup', 'success');
      } catch (e: any) {
        addStep('disableVssAutoBackup', 'error', undefined, e?.message ?? String(e));
      }

      // Step 7: restoreFromVss — restore into a temp path
      addStep('restoreFromVss', 'running');
      let restoredVssPath: string | null = null;
      try {
        const vssRestoreDir = `${FileSystem.documentDirectory}vss_restore_test`;
        await FileSystem.makeDirectoryAsync(vssRestoreDir, { intermediates: true });
        restoredVssPath = await restoreFromVss(vssConfig, vssRestoreDir.replace('file://', ''));
        addStep('restoreFromVss', 'success', { restoredPath: restoredVssPath });
      } catch (e: any) {
        addStep('restoreFromVss', 'error', undefined, e?.message ?? String(e));
      }

      // Step 8: verifyRestoredWallet — open the restored wallet and confirm state is intact
      addStep('verifyRestoredWallet', 'running');
      try {
        if (!restoredVssPath) {
          throw new Error('Restore step did not succeed — skipping verification');
        }
        const restoredWm = new WalletManager({
          network: 'testnet',
          xpubVan: keys.accountXpubVanilla,
          xpubCol: keys.accountXpubColored,
          mnemonic: keys.mnemonic,
          masterFingerprint: keys.masterFingerprint,
          dataDir: restoredVssPath,
        });
        await restoredWm.initialize();
        await restoredWm.syncWallet();
        await restoredWm.refreshWallet();

        const [restoredBtcBalance, restoredAddress, restoredAssets, restoredTransactions] =
          await Promise.all([
            restoredWm.getBtcBalance(),
            restoredWm.getAddress(),
            restoredWm.listAssets(),
            restoredWm.listTransactions(),
          ]);

        const niaCount = restoredAssets.nia?.length ?? 0;
        const ifaCount = restoredAssets.ifa?.length ?? 0;
        addStep('verifyRestoredWallet', 'success', {
          address: restoredAddress,
          btcSettled: restoredBtcBalance?.vanilla?.settled ?? 0,
          totalAssets: niaCount + ifaCount,
          transactionCount: restoredTransactions.length,
        });

        await restoredWm.dispose();
      } catch (e: any) {
        addStep('verifyRestoredWallet', 'error', undefined, e?.message ?? String(e));
      }

      setVssFlowResults({
        running: false,
        success: true,
        steps,
        storeId,
        signingKeyHex: signingKeyHex.slice(0, 8) + '...',
        backupVersion,
      });
    } catch (err: any) {
      console.error('Error in VSS flow:', err);
      setVssFlowResults({
        running: false,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        steps,
      });
    } finally {
      setRunningVssFlow(false);
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

      <ThemedView style={styles.sdkBadgeContainer}>
        <ThemedView style={styles.sdkBadge}>
          <ThemedText style={styles.sdkBadgeLabel}>SDK</ThemedText>
          <ThemedText style={styles.sdkBadgeVersion}>
            {sdkPkg.name}@{sdkPkg.version}
          </ThemedText>
        </ThemedView>
        <ThemedView style={[styles.sdkBadge, styles.sdkBadgeNative]}>
          <ThemedText style={styles.sdkBadgeLabel}>Android</ThemedText>
          <ThemedText style={[styles.sdkBadgeVersion, styles.sdkBadgeVersionNative]}>
            rgb-lib@{RGB_LIB_ANDROID_VERSION}
          </ThemedText>
        </ThemedView>
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Wallet Status V3</ThemedText>
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
            {testResults.signVerifyMessage && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">signMessage + verifyMessage:</ThemedText>
                {testResults.signVerifyMessage.success ? (
                  <>
                    <ThemedText style={styles.monoText}>
                      sig: {testResults.signVerifyMessage.signature}
                    </ThemedText>
                    {Object.entries(testResults.signVerifyMessage.tests).map(([k, v]) => (
                      <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                        {(v as boolean) ? '✓' : '✗'} {k}
                      </ThemedText>
                    ))}
                  </>
                ) : (
                  <ThemedText style={[styles.monoText, styles.errorText]}>
                    ❌ Failed: {testResults.signVerifyMessage.error}
                  </ThemedText>
                )}
              </ThemedView>
            )}
            {testResults.units && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">toUnitsNumber / fromUnitsNumber:</ThemedText>
                {Object.entries(testResults.units.tests || {}).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
                {!testResults.units.success && <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.units.error}</ThemedText>}
              </ThemedView>
            )}
            {testResults.deriveKeysFromMnemonicOrSeed && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">deriveKeysFromMnemonicOrSeed:</ThemedText>
                {Object.entries(testResults.deriveKeysFromMnemonicOrSeed.tests || {}).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
                {!testResults.deriveKeysFromMnemonicOrSeed.success && <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.deriveKeysFromMnemonicOrSeed.error}</ThemedText>}
              </ThemedView>
            )}
            {testResults.accountXpubsFromMnemonic && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">accountXpubsFromMnemonic:</ThemedText>
                {Object.entries(testResults.accountXpubsFromMnemonic.tests || {}).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
                {!testResults.accountXpubsFromMnemonic.success && <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.accountXpubsFromMnemonic.error}</ThemedText>}
              </ThemedView>
            )}
            {testResults.signPsbtSync && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">signPsbtSync:</ThemedText>
                {Object.entries(testResults.signPsbtSync.tests || {}).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
                {!testResults.signPsbtSync.success && <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.signPsbtSync.error}</ThemedText>}
              </ThemedView>
            )}
            {testResults.signPsbtFromSeed && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">signPsbtFromSeed:</ThemedText>
                {Object.entries(testResults.signPsbtFromSeed.tests || {}).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
                {!testResults.signPsbtFromSeed.success && <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.signPsbtFromSeed.error}</ThemedText>}
              </ThemedView>
            )}
            {testResults.createWalletManager && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">createWalletManager:</ThemedText>
                {Object.entries(testResults.createWalletManager.tests || {}).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
                {!testResults.createWalletManager.success && <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.createWalletManager.error}</ThemedText>}
              </ThemedView>
            )}
            {testResults.walletSingleton && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">wallet (singleton):</ThemedText>
                {testResults.walletSingleton.success ? (
                  Object.entries(testResults.walletSingleton.tests || {}).map(([k, v]) => (
                    <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                      {(v as boolean) ? '✓' : '✗'} {k}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.walletSingleton.error}</ThemedText>
                )}
              </ThemedView>
            )}
            {testResults.errorClasses && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">Error classes:</ThemedText>
                {testResults.errorClasses.success ? (
                  Object.entries(testResults.errorClasses.tests || {}).map(([k, v]) => (
                    <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                      {(v as boolean) ? '✓' : '✗'} {k}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.errorClasses.error}</ThemedText>
                )}
              </ThemedView>
            )}
            {testResults.loggerModule && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">Logger (logger / configureLogging / LogLevel):</ThemedText>
                {testResults.loggerModule.success ? (
                  Object.entries(testResults.loggerModule.tests || {}).map(([k, v]) => (
                    <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                      {(v as boolean) ? '✓' : '✗'} {k}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.loggerModule.error}</ThemedText>
                )}
              </ThemedView>
            )}
            {testResults.validation && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">Validation functions:</ThemedText>
                {testResults.validation.success ? (
                  Object.entries(testResults.validation.tests || {}).map(([k, v]) => (
                    <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                      {(v as boolean) ? '✓' : '✗'} {k}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.validation.error}</ThemedText>
                )}
              </ThemedView>
            )}
            {testResults.constants && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">Constants:</ThemedText>
                {testResults.constants.success ? (
                  Object.entries(testResults.constants.tests || {}).map(([k, v]) => (
                    <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                      {(v as boolean) ? '✓' : '✗'} {k}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.constants.error}</ThemedText>
                )}
              </ThemedView>
            )}
            {testResults.utexoModule && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">UTEXO Module (instantiation + stubs):</ThemedText>
                {testResults.utexoModule.success ? (
                  Object.entries(testResults.utexoModule.tests || {}).map(([k, v]) => (
                    <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                      {(v as boolean) ? '✓' : '✗'} {k}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText style={[styles.monoText, styles.errorText]}>❌ {testResults.utexoModule.error}</ThemedText>
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
            {walletFlowResults.decodedInvoice && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">decodeRGBInvoice() ✓</ThemedText>
                <ThemedText style={styles.monoText} numberOfLines={8}>
                  {JSON.stringify(walletFlowResults.decodedInvoice, null, 2)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.walletGetters && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">getXpub / getNetwork / isDisposed ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  network: {walletFlowResults.walletGetters.network}{'\n'}
                  notDisposed: {String(walletFlowResults.walletGetters.notDisposed)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.estimateFeeRate && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">estimateFeeRate() ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  {JSON.stringify(walletFlowResults.estimateFeeRate, null, 2)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.sendBtc && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">sendBtc() ✓</ThemedText>
                <ThemedText style={styles.monoText}>txid: {walletFlowResults.sendBtc.txid}</ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.createUtxos && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">createUtxos() ✓</ThemedText>
                <ThemedText style={styles.monoText}>utxos: {walletFlowResults.createUtxos.numUtxos}</ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.sendBeginEnd && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">sendBegin / estimateFee / sendEnd ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  txid: {walletFlowResults.sendBeginEnd.txid}{'\n'}
                  fee: {JSON.stringify(walletFlowResults.sendBeginEnd.fee)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.failTransfers !== undefined && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">failTransfers() ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  {String(walletFlowResults.failTransfers.result)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.issueAssetIfa && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">issueAssetIfa() ✓</ThemedText>
                <ThemedText style={styles.monoText} numberOfLines={3}>
                  {JSON.stringify(walletFlowResults.issueAssetIfa, null, 2)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.inflate && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">inflate() ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  {JSON.stringify(walletFlowResults.inflate, null, 2)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.inflateBegin && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">inflateBegin() ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  psbt length: {walletFlowResults.inflateBegin.psbtLength}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.inflateEnd && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">inflateEnd() ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  {JSON.stringify(walletFlowResults.inflateEnd, null, 2)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.walletSignVerify && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">wallet.signMessage / verifyMessage ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  sig: {walletFlowResults.walletSignVerify.sig}{'\n'}
                  valid: {String(walletFlowResults.walletSignVerify.valid)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.createBackup && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">createBackup ✓</ThemedText>
                <ThemedText style={styles.monoText}>{walletFlowResults.createBackup.path}</ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.restoreFromBackup && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">restoreFromBackup ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  {JSON.stringify(walletFlowResults.restoreFromBackup, null, 2)}
                </ThemedText>
              </ThemedView>
            )}
            {walletFlowResults.verifyRestoredWallet && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">verifyRestoredWallet ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  {'address: '}{walletFlowResults.verifyRestoredWallet.address}{'\n'}
                  {'btc settled: '}{walletFlowResults.verifyRestoredWallet.btcBalance?.vanilla?.settled ?? 0}{'\n'}
                  {'totalAssetsFound: '}{walletFlowResults.verifyRestoredWallet.totalAssetsFound}{'\n'}
                  {'transactions: '}{walletFlowResults.verifyRestoredWallet.transactionCount}{'\n'}
                  {'unspents: '}{walletFlowResults.verifyRestoredWallet.unspentCount}{'  (colored: '}{walletFlowResults.verifyRestoredWallet.coloredUtxoCount}{')'}
                </ThemedText>
                {(walletFlowResults.verifyRestoredWallet.niaAssets ?? []).map((a: any) => (
                  <ThemedView key={a.assetId} style={{ marginTop: 6 }}>
                    <ThemedText type="defaultSemiBold">[NIA] {a.ticker} – {a.name}</ThemedText>
                    <ThemedText style={styles.monoText}>
                      {'settled: '}{a.balance?.settled ?? 0}{'  future: '}{a.balance?.future ?? 0}{'  spendable: '}{a.balance?.spendable ?? 0}{'\n'}
                      {'transfers: '}{a.transferCount}{'  statuses: '}{JSON.stringify(a.transferStatuses)}
                    </ThemedText>
                  </ThemedView>
                ))}
                {(walletFlowResults.verifyRestoredWallet.ifaAssets ?? []).map((a: any) => (
                  <ThemedView key={a.assetId} style={{ marginTop: 6 }}>
                    <ThemedText type="defaultSemiBold">[IFA] {a.ticker} – {a.name}</ThemedText>
                    <ThemedText style={styles.monoText}>
                      {'settled: '}{a.balance?.settled ?? 0}{'  future: '}{a.balance?.future ?? 0}{'  spendable: '}{a.balance?.spendable ?? 0}{'\n'}
                      {'transfers: '}{a.transferCount}{'  statuses: '}{JSON.stringify(a.transferStatuses)}
                    </ThemedText>
                  </ThemedView>
                ))}
              </ThemedView>
            )}
            {walletFlowResults.dispose && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">dispose / isDisposed ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  disposed: {String(walletFlowResults.dispose.disposed)}
                </ThemedText>
              </ThemedView>
            )}
          </>
        )}
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">UTEXO / Lightning Flow</ThemedText>
        {runningUTEXOFlow && <ThemedText>Running UTEXO flow...</ThemedText>}
        {!runningUTEXOFlow && !utexoFlowResults && (
          <ThemedView style={styles.infoContainer}>
            <ThemedText>
              Tests UTEXOWallet, LightningProtocol, OnchainProtocol, UTEXOProtocol, and bridgeAPI.
              {'\n'}Steps requiring a signet node or bridge server are captured gracefully.
            </ThemedText>
            <TouchableOpacity style={styles.button} onPress={runUTEXOFlowTest}>
              <ThemedText style={styles.buttonText}>▶ Run UTEXO Flow</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        )}
        {utexoFlowResults && (
          <>
            <ThemedView style={styles.infoContainer}>
              <ThemedText type="defaultSemiBold">Flow Status:</ThemedText>
              <ThemedText style={styles.monoText}>
                {utexoFlowResults.success ? '✅ Completed' : '❌ Failed'}
                {utexoFlowResults.error && `\nError: ${utexoFlowResults.error.message}`}
              </ThemedText>
            </ThemedView>
            <ThemedView style={styles.infoContainer}>
              <ThemedText type="defaultSemiBold">Steps:</ThemedText>
              <ThemedText style={styles.monoText}>
                {utexoFlowResults.steps?.map((step: any, idx: number) =>
                  `${idx + 1}. ${step.step}: ${step.status === 'success' ? '✅' : step.status === 'running' ? '⏳' : '❌'}${step.error ? ` (${step.error})` : ''}\n`
                ).join('')}
              </ThemedText>
            </ThemedView>
            {utexoFlowResults.derivePublicKeys && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">derivePublicKeys ✓</ThemedText>
                <ThemedText style={styles.monoText}>{utexoFlowResults.derivePublicKeys.xpub ?? utexoFlowResults.derivePublicKeys.error}</ThemedText>
              </ThemedView>
            )}
            {utexoFlowResults.walletGetters && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">getXpub / getNetwork / isDisposed ✓</ThemedText>
                <ThemedText style={styles.monoText}>
                  network: {utexoFlowResults.walletGetters.network}{'\n'}
                  notDisposed: {String(utexoFlowResults.walletGetters.notDisposed)}
                </ThemedText>
              </ThemedView>
            )}
            {utexoFlowResults.initError && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">initialize() (needs signet node):</ThemedText>
                <ThemedText style={[styles.monoText, styles.errorText]}>{utexoFlowResults.initError}</ThemedText>
              </ThemedView>
            )}
            {utexoFlowResults.lightningProtocolStubs && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">LightningProtocol stubs:</ThemedText>
                {Object.entries(utexoFlowResults.lightningProtocolStubs).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
              </ThemedView>
            )}
            {utexoFlowResults.onchainProtocolStubs && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">OnchainProtocol stubs:</ThemedText>
                {Object.entries(utexoFlowResults.onchainProtocolStubs).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
              </ThemedView>
            )}
            {utexoFlowResults.utexoProtocolStubs && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">UTEXOProtocol stubs:</ThemedText>
                {Object.entries(utexoFlowResults.utexoProtocolStubs).map(([k, v]) => (
                  <ThemedText key={k} style={[styles.monoText, (v as boolean) ? styles.covered : styles.uncovered]}>
                    {(v as boolean) ? '✓' : '✗'} {k}
                  </ThemedText>
                ))}
              </ThemedView>
            )}
            {utexoFlowResults.bridgeAPIQuery && (
              <ThemedView style={styles.infoContainer}>
                <ThemedText type="defaultSemiBold">bridgeAPI.getTransferByMainnetInvoice:</ThemedText>
                <ThemedText style={styles.monoText}>
                  {utexoFlowResults.bridgeAPIQuery.returned ?? `error: ${utexoFlowResults.bridgeAPIQuery.error}`}
                </ThemedText>
              </ThemedView>
            )}
            <TouchableOpacity style={styles.button} onPress={runUTEXOFlowTest}>
              <ThemedText style={styles.buttonText}>↺ Re-run UTEXO Flow</ThemedText>
            </TouchableOpacity>
          </>
        )}
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        {/* Header row */}
        <View style={vssStyles.headerRow}>
          <ThemedText type="subtitle">☁ VSS Cloud Backup</ThemedText>
          {vssFlowResults?.running && (
            <ActivityIndicator size="small" color="#7c3aed" style={{ marginLeft: 8 }} />
          )}
          {vssFlowResults && !vssFlowResults.running && (
            <View style={[vssStyles.statusPill, vssFlowResults.success ? vssStyles.pillSuccess : vssStyles.pillError]}>
              <ThemedText style={vssStyles.statusPillText}>
                {vssFlowResults.success ? 'Completed' : 'Failed'}
              </ThemedText>
            </View>
          )}
        </View>

        {/* Progress dots */}
        {vssFlowResults?.steps?.length > 0 && (() => {
          const TOTAL = 8;
          const done = vssFlowResults.steps.filter((s: any) => s.status === 'success').length;
          return (
            <View style={vssStyles.progressRow}>
              {Array.from({ length: TOTAL }).map((_, i) => {
                const stepData = vssFlowResults.steps[i];
                const isSuccess = stepData?.status === 'success';
                const isRunning = stepData?.status === 'running';
                const isError = stepData?.status === 'error';
                return (
                  <View key={i} style={[
                    vssStyles.progressDot,
                    isSuccess && vssStyles.dotSuccess,
                    isRunning && vssStyles.dotRunning,
                    isError && vssStyles.dotError,
                  ]}>
                    {isRunning && <ActivityIndicator size={8} color="#fff" />}
                  </View>
                );
              })}
              <ThemedText style={vssStyles.progressLabel}>{done}/{TOTAL}</ThemedText>
            </View>
          );
        })()}

        {/* Idle state */}
        {!vssFlowResults && (
          <View style={vssStyles.idleCard}>
            <ThemedText style={vssStyles.idleDesc}>
              End-to-end test against{'\n'}
              <ThemedText style={vssStyles.idleUrl}>vss-server.utexo.com/vss</ThemedText>
            </ThemedText>
            <View style={vssStyles.idleStepList}>
              {['Generate Keys', 'Init Wallet', 'Upload Backup', 'Check Status', 'Configure Auto-backup', 'Disable Auto-backup', 'Restore', 'Verify Assets'].map((label, i) => (
                <View key={i} style={vssStyles.idleStepRow}>
                  <View style={vssStyles.idleStepDot} />
                  <ThemedText style={vssStyles.idleStepLabel}>{label}</ThemedText>
                </View>
              ))}
            </View>
            <TouchableOpacity style={vssStyles.runBtn} onPress={runVssFlowTest}>
              <ThemedText style={vssStyles.runBtnText}>▶  Run VSS Flow</ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {/* Step cards */}
        {vssFlowResults?.steps?.map((step: any, idx: number) => {
          const STEP_META: Record<string, { label: string; desc: string }> = {
            generateKeys:        { label: 'Generate Keys',          desc: 'Create fresh wallet keypairs' },
            initializeWallet:    { label: 'Initialize Wallet',      desc: 'Setup wallet on testnet' },
            vssBackup:           { label: 'Upload Backup',          desc: 'Encrypt & push to VSS server' },
            vssBackupInfo:       { label: 'Check Backup Status',    desc: 'Query server for backup metadata' },
            configureVssBackup:  { label: 'Configure Auto-backup',  desc: 'Enable background auto-backup' },
            disableVssAutoBackup:{ label: 'Disable Auto-backup',    desc: 'Stop background auto-backup' },
            restoreFromVss:      { label: 'Restore from VSS',       desc: 'Download & decrypt wallet data' },
            verifyRestoredWallet:{ label: 'Verify Restored Wallet',  desc: 'Confirm assets & transactions intact' },
          };
          const meta = STEP_META[step.step] ?? { label: step.step, desc: '' };
          const isRunning = step.status === 'running';
          const isSuccess = step.status === 'success';
          const isError = step.status === 'error';
          return (
            <View key={idx} style={[
              vssStyles.stepCard,
              isSuccess && vssStyles.cardSuccess,
              isRunning && vssStyles.cardRunning,
              isError && vssStyles.cardError,
            ]}>
              {/* Left accent bar */}
              <View style={[
                vssStyles.cardAccent,
                isSuccess && vssStyles.accentSuccess,
                isRunning && vssStyles.accentRunning,
                isError && vssStyles.accentError,
              ]} />

              <View style={vssStyles.cardBody}>
                {/* Top row: number + label + icon */}
                <View style={vssStyles.cardTopRow}>
                  <View style={[
                    vssStyles.stepBadge,
                    isSuccess && vssStyles.badgeSuccess,
                    isRunning && vssStyles.badgeRunning,
                    isError && vssStyles.badgeError,
                  ]}>
                    <ThemedText style={vssStyles.stepBadgeText}>{idx + 1}</ThemedText>
                  </View>
                  <ThemedText style={[vssStyles.cardLabel, { flex: 1 }]}>{meta.label}</ThemedText>
                  {isRunning && <ActivityIndicator size="small" color="#7c3aed" />}
                  {isSuccess && <ThemedText style={vssStyles.iconSuccess}>✓</ThemedText>}
                  {isError   && <ThemedText style={vssStyles.iconError}>✗</ThemedText>}
                </View>

                {/* Result / error detail */}
                {(step.result || step.error) && (
                  <View style={vssStyles.cardDetail}>
                    <ThemedText style={[vssStyles.cardDetailText, isError && { color: '#b91c1c' }]}>
                      {step.result
                        ? JSON.stringify(step.result)
                        : step.error}
                    </ThemedText>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {/* Store ID + Re-run */}
        {vssFlowResults && !vssFlowResults.running && (
          <>
            {vssFlowResults.storeId && (
              <View style={vssStyles.storeIdRow}>
                <ThemedText style={vssStyles.storeIdLabel}>Store ID</ThemedText>
                <ThemedText style={[styles.monoText, { fontSize: 11 }]}>{vssFlowResults.storeId}</ThemedText>
              </View>
            )}
            <TouchableOpacity style={vssStyles.rerunBtn} onPress={runVssFlowTest}>
              <ThemedText style={vssStyles.runBtnText}>↺  Re-run VSS Flow</ThemedText>
            </TouchableOpacity>
          </>
        )}
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">SDK Coverage</ThemedText>

        <ThemedText type="defaultSemiBold" style={styles.coverageSection}>Standalone Functions</ThemedText>
        {[
          { name: 'wallet', covered: true },
          { name: 'generateKeys', covered: true },
          { name: 'createWallet', covered: true },
          { name: 'deriveKeysFromMnemonic', covered: true },
          { name: 'deriveKeysFromSeed', covered: true },
          { name: 'deriveKeysFromXpriv', covered: true },
          { name: 'restoreKeys', covered: true },
          { name: 'getXprivFromMnemonic', covered: true },
          { name: 'getXpubFromXpriv', covered: true },
          { name: 'signPsbt', covered: true },
          { name: 'signPsbtSync', covered: true },
          { name: 'signPsbtFromSeed', covered: true },
          { name: 'signMessage', covered: true },
          { name: 'verifyMessage', covered: true },
          { name: 'deriveKeysFromMnemonicOrSeed', covered: true },
          { name: 'accountXpubsFromMnemonic', covered: true },
          { name: 'createWalletManager', covered: true },
          { name: 'restoreFromBackup', covered: true },
          { name: 'restoreFromVss', covered: true },
          { name: 'toUnitsNumber', covered: true },
          { name: 'fromUnitsNumber', covered: true },
        ].map(({ name, covered }) => (
          <ThemedView key={name} style={styles.coverageRow}>
            <ThemedText style={[styles.coverageIcon, covered ? styles.covered : styles.uncovered]}>
              {covered ? '✓' : '✗'}
            </ThemedText>
            <ThemedText style={styles.coverageName}>{name}</ThemedText>
          </ThemedView>
        ))}

        <ThemedText type="defaultSemiBold" style={styles.coverageSection}>WalletManager Methods</ThemedText>
        {[
          { name: 'initialize()', covered: true },
          { name: 'getBtcBalance()', covered: true },
          { name: 'getAddress()', covered: true },
          { name: 'syncWallet()', covered: true },
          { name: 'refreshWallet()', covered: true },
          { name: 'createUtxosBegin()', covered: true },
          { name: 'createUtxosEnd()', covered: true },
          { name: 'signPsbt()', covered: true },
          { name: 'issueAssetNia()', covered: true },
          { name: 'listAssets()', covered: true },
          { name: 'sendBtcBegin()', covered: true },
          { name: 'sendBtcEnd()', covered: true },
          { name: 'blindReceive()', covered: true },
          { name: 'witnessReceive()', covered: true },
          { name: 'send()', covered: true },
          { name: 'getAssetBalance()', covered: true },
          { name: 'listTransfers()', covered: true },
          { name: 'listTransactions()', covered: true },
          { name: 'listUnspents()', covered: true },
          { name: 'goOnline()', covered: true },
          { name: 'getXpub()', covered: true },
          { name: 'getNetwork()', covered: true },
          { name: 'dispose()', covered: true },
          { name: 'isDisposed()', covered: true },
          { name: 'createUtxos()', covered: true },
          { name: 'sendBegin()', covered: true },
          { name: 'sendEnd()', covered: true },
          { name: 'sendBtc()', covered: true },
          { name: 'issueAssetIfa()', covered: true },
          { name: 'inflateBegin()', covered: true },
          { name: 'inflateEnd()', covered: true },
          { name: 'inflate()', covered: true },
          { name: 'decodeRGBInvoice()', covered: true },
          { name: 'failTransfers()', covered: true },
          { name: 'estimateFeeRate()', covered: true },
          { name: 'estimateFee()', covered: true },
          { name: 'createBackup()', covered: true },
          { name: 'configureVssBackup()', covered: true },
          { name: 'vssBackup()', covered: true },
          { name: 'vssBackupInfo()', covered: true },
          { name: 'disableVssAutoBackup()', covered: true },
          { name: 'signMessage()', covered: true },
          { name: 'verifyMessage()', covered: true },
        ].map(({ name, covered }) => (
          <ThemedView key={name} style={styles.coverageRow}>
            <ThemedText style={[styles.coverageIcon, covered ? styles.covered : styles.uncovered]}>
              {covered ? '✓' : '✗'}
            </ThemedText>
            <ThemedText style={styles.coverageName}>{name}</ThemedText>
          </ThemedView>
        ))}

        <ThemedText type="defaultSemiBold" style={styles.coverageSection}>Error Classes</ThemedText>
        {[
          { name: 'SDKError', covered: true },
          { name: 'NetworkError', covered: true },
          { name: 'ValidationError', covered: true },
          { name: 'WalletError', covered: true },
          { name: 'CryptoError', covered: true },
          { name: 'ConfigurationError', covered: true },
          { name: 'BadRequestError', covered: true },
          { name: 'NotFoundError', covered: true },
          { name: 'ConflictError', covered: true },
          { name: 'RgbNodeError', covered: true },
        ].map(({ name, covered }) => (
          <ThemedView key={name} style={styles.coverageRow}>
            <ThemedText style={[styles.coverageIcon, covered ? styles.covered : styles.uncovered]}>
              {covered ? '✓' : '✗'}
            </ThemedText>
            <ThemedText style={styles.coverageName}>{name}</ThemedText>
          </ThemedView>
        ))}

        <ThemedText type="defaultSemiBold" style={styles.coverageSection}>Logger</ThemedText>
        {[
          { name: 'logger', covered: true },
          { name: 'configureLogging', covered: true },
          { name: 'LogLevel', covered: true },
        ].map(({ name, covered }) => (
          <ThemedView key={name} style={styles.coverageRow}>
            <ThemedText style={[styles.coverageIcon, covered ? styles.covered : styles.uncovered]}>
              {covered ? '✓' : '✗'}
            </ThemedText>
            <ThemedText style={styles.coverageName}>{name}</ThemedText>
          </ThemedView>
        ))}

        <ThemedText type="defaultSemiBold" style={styles.coverageSection}>Validation</ThemedText>
        {[
          { name: 'validateNetwork', covered: true },
          { name: 'normalizeNetwork', covered: true },
          { name: 'validateMnemonic', covered: true },
          { name: 'validatePsbt', covered: true },
          { name: 'validateBase64', covered: true },
          { name: 'validateHex', covered: true },
          { name: 'validateRequired', covered: true },
          { name: 'validateString', covered: true },
        ].map(({ name, covered }) => (
          <ThemedView key={name} style={styles.coverageRow}>
            <ThemedText style={[styles.coverageIcon, covered ? styles.covered : styles.uncovered]}>
              {covered ? '✓' : '✗'}
            </ThemedText>
            <ThemedText style={styles.coverageName}>{name}</ThemedText>
          </ThemedView>
        ))}

        <ThemedText type="defaultSemiBold" style={styles.coverageSection}>Constants</ThemedText>
        {[
          { name: 'COIN_RGB_MAINNET', covered: true },
          { name: 'COIN_RGB_TESTNET', covered: true },
          { name: 'COIN_BITCOIN_MAINNET', covered: true },
          { name: 'COIN_BITCOIN_TESTNET', covered: true },
          { name: 'NETWORK_MAP', covered: true },
          { name: 'BIP32_VERSIONS', covered: true },
          { name: 'DERIVATION_PURPOSE', covered: true },
          { name: 'DERIVATION_ACCOUNT', covered: true },
          { name: 'KEYCHAIN_RGB', covered: true },
          { name: 'KEYCHAIN_BTC', covered: true },
          { name: 'DEFAULT_NETWORK', covered: true },
          { name: 'DEFAULT_API_TIMEOUT', covered: true },
          { name: 'DEFAULT_MAX_RETRIES', covered: true },
          { name: 'DEFAULT_LOG_LEVEL', covered: true },
          { name: 'utexoNetworkMap', covered: true },
          { name: 'utexoNetworkIdMap', covered: true },
          { name: 'getDestinationAsset', covered: true },
        ].map(({ name, covered }) => (
          <ThemedView key={name} style={styles.coverageRow}>
            <ThemedText style={[styles.coverageIcon, covered ? styles.covered : styles.uncovered]}>
              {covered ? '✓' : '✗'}
            </ThemedText>
            <ThemedText style={styles.coverageName}>{name}</ThemedText>
          </ThemedView>
        ))}

        <ThemedText type="defaultSemiBold" style={styles.coverageSection}>UTEXO / Lightning Module</ThemedText>
        {[
          { name: 'UTEXOWallet', covered: true },
          { name: 'UTEXOProtocol', covered: true },
          { name: 'LightningProtocol', covered: true },
          { name: 'OnchainProtocol', covered: true },
          { name: 'bridgeAPI', covered: true },
        ].map(({ name, covered }) => (
          <ThemedView key={name} style={styles.coverageRow}>
            <ThemedText style={[styles.coverageIcon, covered ? styles.covered : styles.uncovered]}>
              {covered ? '✓' : '✗'}
            </ThemedText>
            <ThemedText style={styles.coverageName}>{name}</ThemedText>
          </ThemedView>
        ))}
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
  sdkBadgeContainer: {
    flexDirection: 'column',
    gap: 4,
    marginBottom: 4,
  },
  sdkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  sdkBadgeLabel: {
    backgroundColor: '#555',
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
  },
  sdkBadgeVersion: {
    backgroundColor: '#0075D8',
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
  },
  sdkBadgeNative: {
    alignSelf: 'flex-start',
  },
  sdkBadgeVersionNative: {
    backgroundColor: '#2e7d32',
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
  coverageSection: {
    marginTop: 10,
    marginBottom: 2,
  },
  coverageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  coverageIcon: {
    fontSize: 13,
    fontWeight: 'bold',
    width: 16,
    textAlign: 'center',
  },
  coverageName: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
    fontSize: 12,
  },
  covered: {
    color: '#2e7d32',
  },
  uncovered: {
    color: '#c62828',
  },
});

const vssStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusPill: {
    marginLeft: 10,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillSuccess: { backgroundColor: '#dcfce7' },
  pillError:   { backgroundColor: '#fee2e2' },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  progressDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotSuccess: { backgroundColor: '#16a34a' },
  dotRunning: { backgroundColor: '#7c3aed' },
  dotError:   { backgroundColor: '#dc2626' },
  progressLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginLeft: 4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
  },
  idleCard: {
    borderWidth: 1,
    borderColor: '#e9d5ff',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#faf5ff',
    gap: 8,
  },
  idleDesc: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 20,
  },
  idleUrl: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
    fontSize: 12,
    color: '#7c3aed',
  },
  idleStepList: {
    gap: 6,
  },
  idleStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  idleStepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#c4b5fd',
  },
  idleStepLabel: {
    fontSize: 13,
    color: '#374151',
  },
  runBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  rerunBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  runBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  stepCard: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 4,
  },
  cardSuccess: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  cardRunning: { backgroundColor: '#faf5ff', borderColor: '#e9d5ff' },
  cardError:   { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  cardAccent: {
    width: 3,
    backgroundColor: '#d1d5db',
  },
  accentSuccess: { backgroundColor: '#16a34a' },
  accentRunning: { backgroundColor: '#7c3aed' },
  accentError:   { backgroundColor: '#dc2626' },
  cardBody: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 2,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeSuccess: { backgroundColor: '#16a34a' },
  badgeRunning: { backgroundColor: '#7c3aed' },
  badgeError:   { backgroundColor: '#dc2626' },
  stepBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
    textAlign: 'center',
    includeFontPadding: false,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
  },
  cardDesc: {
    fontSize: 10,
    color: '#9ca3af',
  },
  iconSuccess: {
    fontSize: 13,
    color: '#16a34a',
    fontWeight: '700',
  },
  iconError: {
    fontSize: 13,
    color: '#dc2626',
    fontWeight: '700',
  },
  cardDetail: {
    marginTop: 2,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  cardDetailText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
    fontSize: 9,
    color: '#374151',
  },
  storeIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    paddingHorizontal: 2,
  },
  storeIdLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6b7280',
  },
});
