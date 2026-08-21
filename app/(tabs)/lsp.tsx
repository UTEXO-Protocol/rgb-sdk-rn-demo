import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import ApayIfaScreen from '@/screens/apay-ifa';
import ApayLinkedAssetScreen from '@/screens/apay-linked-asset';
import ApayLinkedAssetSignetScreen from '@/screens/apay-linked-asset-signet/index';
import ApayRegularChannelsScreen from '@/screens/apay-regular-channels';
import ScidReproScreen from '@/screens/apay-scid-repro/index';
import ScidReproSignetScreen from '@/screens/apay-scid-repro-signet/index';
import ApaySignetScreen from '@/screens/apay-signet/index';
import AsyncPayScreen from '@/screens/async-pay';
import LspRegtestScreen, { LspRegtestVirtualScreen } from '@/screens/lsp-regtest/index';
import LspSignetScreen from '@/screens/lsp-signet/index';

const TABS = [
  { key: 'regtest', label: 'Regtest' },
  { key: 'utexo',   label: 'UTEXO' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function LspHubScreen() {
  const [activeTab, setActiveTab] = useState<TabKey>('regtest');
  const insets = useSafeAreaInsets();

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: insets.top + 24, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
        <Text style={s.headerTitle}>LSP</Text>
        <Text style={s.headerSubtitle}>
          Lightning Service Provider flows — grouped by network.
        </Text>
        <View style={s.tabRow}>
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[s.tabBtn, activeTab === tab.key && s.tabBtnActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.75}
            >
              <Text style={[s.tabBtnText, activeTab === tab.key && s.tabBtnTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <SafeAreaInsetsContext.Consumer>
        {(ctxInsets) => (
          <SafeAreaInsetsContext.Provider value={{ ...(ctxInsets ?? insets), top: 0 }}>
            <View style={s.content}>
              <View style={[s.pane, activeTab !== 'regtest' && s.paneHidden]}>
                <ScrollView
                  style={s.paneScroll}
                  contentContainerStyle={s.paneContent}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {/* Bridge Asset first: it is the flow under active work, and
                      the only one that needs TWO_ASSETS=1. */}
                  <ApayLinkedAssetScreen embedded />
                  <View style={s.flowDivider} />
                  <LspRegtestScreen embedded />
                  <View style={s.flowDivider} />
                  <LspRegtestVirtualScreen embedded />
                  <View style={s.flowDivider} />
                  <AsyncPayScreen embedded />
                  <View style={s.flowDivider} />
                  <ApayRegularChannelsScreen embedded />
                  <View style={s.flowDivider} />
                  <ApayIfaScreen embedded />
                  <View style={s.flowDivider} />
                  <ScidReproScreen embedded />
                </ScrollView>
              </View>
              <View style={[s.pane, activeTab !== 'utexo' && s.paneHidden]}>
                <ScrollView
                  style={s.paneScroll}
                  contentContainerStyle={s.paneContent}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {/* Bridge Asset first, mirroring the Regtest pane: it is the
                      flow under active work, and the only one that needs the
                      two-asset utexo-lsp (utexo-lsp/.env.signet). */}
                  <ApayLinkedAssetSignetScreen embedded />
                  <View style={s.flowDivider} />
                  <LspSignetScreen embedded />
                  <View style={s.flowDivider} />
                  <ApaySignetScreen embedded />
                  <View style={s.flowDivider} />
                  <ScidReproSignetScreen embedded />
                </ScrollView>
              </View>
            </View>
          </SafeAreaInsetsContext.Provider>
        )}
      </SafeAreaInsetsContext.Consumer>
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: AppColors.bgBase },
  header:          { paddingBottom: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: AppColors.border, backgroundColor: AppColors.bgCard },
  headerTitle:     { fontSize: 26, fontWeight: '800', color: AppColors.textPrimary, letterSpacing: 0.5 },
  headerSubtitle:  { fontSize: 14, color: AppColors.textSecondary, lineHeight: 20 },
  tabRow:          { flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: AppColors.border, overflow: 'hidden', marginTop: 4 },
  tabBtn:          { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: AppColors.bgBase },
  tabBtnActive:    { backgroundColor: AppColors.primary },
  tabBtnText:      { fontSize: 13, fontWeight: '600', color: AppColors.textSecondary },
  tabBtnTextActive:{ color: AppColors.black },
  content:         { flex: 1 },
  pane:            { flex: 1 },
  paneHidden:      { display: 'none' },
  paneScroll:      { flex: 1 },
  paneContent:     { paddingBottom: 40 },
  flowDivider:     { height: 1, backgroundColor: AppColors.border, marginHorizontal: 16, marginVertical: 8 },
});
