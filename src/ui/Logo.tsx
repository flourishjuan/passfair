// The Passfair mark in the centre of the header. It breathes when idle and spins a two-tone ring while
// the agents work. Tap it to see who is doing what.
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Image, Pressable, View } from "react-native";
import { T } from "./theme";

export function Logo({ busy, onPress, size = 40 }: { busy: boolean; onPress?: () => void; size?: number }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: busy ? 700 : 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: busy ? 700 : 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    b.start();
    return () => b.stop();
  }, [busy, breathe]);
  useEffect(() => {
    if (!busy) {
      spin.stopAnimation();
      return;
    }
    spin.setValue(0);
    const s = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    s.start();
    return () => s.stop();
  }, [busy, spin]);
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, busy ? 1.1 : 1.05] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const ring = size + 12;
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={busy ? "Agents at work — show details" : "Passfair"}>
      <View style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}>
        {busy && (
          <Animated.View
            style={{
              position: "absolute",
              width: ring,
              height: ring,
              borderRadius: ring,
              borderWidth: 2.5,
              borderTopColor: T.purple,
              borderRightColor: T.lime,
              borderBottomColor: "transparent",
              borderLeftColor: "transparent",
              transform: [{ rotate }],
            }}
          />
        )}
        <Animated.View style={{ transform: [{ scale }] }}>
          <Image
            source={require("../../assets/icon.png")}
            style={{ width: size, height: size, borderRadius: size / 4 }}
          />
        </Animated.View>
      </View>
    </Pressable>
  );
}
