// Small borderless building blocks shared by every screen.
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { F, T } from "./theme";

export function Btn({
  label,
  onPress,
  kind = "soft",
  disabled,
  small,
  locked,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "soft" | "plain" | "danger" | "lime";
  disabled?: boolean;
  small?: boolean;
  locked?: boolean;
}) {
  const bg = { primary: T.ink, soft: T.surface, plain: "transparent", danger: T.dangerSoft, lime: T.lime }[kind];
  const fg = kind === "primary" ? T.white : kind === "danger" ? T.danger : T.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        k.btn,
        small && k.btnSmall,
        kind === "plain" && { paddingHorizontal: 8 },
        { backgroundColor: bg, opacity: disabled ? 0.38 : pressed ? 0.7 : locked ? 0.55 : 1 },
      ]}
    >
      <Text style={[k.btnText, small && { fontSize: 14 }, { color: fg }]}>
        {locked ? "🔒 " : ""}
        {label}
      </Text>
    </Pressable>
  );
}
export function Chip({
  label,
  on,
  onPress,
  locked,
  color,
}: {
  label: string;
  on?: boolean;
  onPress?: () => void;
  locked?: boolean;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [k.chip, on && { backgroundColor: T.ink }, { opacity: pressed ? 0.7 : locked ? 0.5 : 1 }]}
    >
      {!!color && <View style={[k.dot, { backgroundColor: color }]} />}
      <Text style={[k.chipText, on && { color: T.white }]}>
        {locked ? "🔒 " : ""}
        {label}
      </Text>
    </Pressable>
  );
}
export const Dot = ({ color, size = 8 }: { color: string; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
);
export function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={F.label}>{title.toUpperCase()}</Text>
      {children}
      {!!note && <Text style={F.small}>{note}</Text>}
    </View>
  );
}
export function Input(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={T.faint} {...props} style={[k.input, props.style]} />;
}
export function ToggleRow({
  label,
  note,
  value,
  onChange,
  locked,
  disabled,
}: {
  label: string;
  note?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={k.toggle}>
      <View style={{ flex: 1, gap: 2, opacity: locked || disabled ? 0.5 : 1 }}>
        <Text style={F.head}>
          {locked ? "🔒 " : ""}
          {label}
        </Text>
        {!!note && <Text style={F.small}>{note}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: T.purple }} />
    </View>
  );
}
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={["top", "bottom"]}>
        <View style={k.sheetHead}>
          <Text style={F.title}>{title}</Text>
          <Btn label="Done" kind="plain" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={k.sheetBody} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
export const Row = ({
  children,
  gap = 8,
  wrap = true,
}: {
  children: React.ReactNode;
  gap?: number;
  wrap?: boolean;
}) => (
  <View style={{ flexDirection: "row", flexWrap: wrap ? "wrap" : "nowrap", gap, alignItems: "center" }}>
    {children}
  </View>
);

export const k = StyleSheet.create({
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSmall: { paddingHorizontal: 14, paddingVertical: 8 },
  btnText: { fontSize: 15, fontWeight: "400", letterSpacing: -0.1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: T.surface,
  },
  chipText: { fontSize: 14, fontWeight: "400", color: T.ink },
  dot: { width: 8, height: 8, borderRadius: 8 },
  input: {
    backgroundColor: T.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: T.ink,
  },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  sheetHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sheetBody: { padding: 20, gap: 28, paddingBottom: 60 },
});
