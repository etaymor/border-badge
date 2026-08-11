/**
 * QuizPlayScreen - placeholder seam for U5 (owner play).
 *
 * TODO(U5): replace with the real owner play experience (POST /quiz/{id}/play,
 * per-question answers, completion + score-to-beat seeding). Registered now so
 * QuizCreationScreen has a stable route to navigate to on success.
 */

import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { RootStackScreenProps } from '@navigation/types';

type Props = RootStackScreenProps<'QuizPlay'>;

export function QuizPlayScreen({ navigation, route }: Props) {
  return (
    <Screen>
      <View style={styles.container} testID="quiz-play-placeholder">
        <Text style={styles.title}>Your Quiz Is Ready</Text>
        <Text style={styles.body}>
          Playing your quiz is coming next. Quiz ID: {route.params.quizId}
        </Text>
        <Button title="Back" variant="ghost" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
