/**
 * MyQuizzesScreen - the owner's Guess Where management surface.
 *
 * An editorial card list: the newest challenge with a cover photo runs as a
 * full-width featured card (photo on top, state pill over the photo), the
 * rest as compact thumbnail rows. Every card leads with its date as the
 * title, carries one primary action as a chevron row along its bottom edge,
 * and tucks its single destructive action (delete for pre-play states,
 * revoke for shared) behind an ellipsis - the confirmation Alert names the
 * action before anything happens.
 *
 * Lifecycle states and the actions they allow:
 * - building ("Draft"): resume creation / delete
 * - awaiting_owner_play ("Ready to play"): play now / delete
 * - playable ("Ready to share"): share (via the results screen)
 * - shared ("Shared"): view leaderboard (R14) / revoke
 * - revoked ("Revoked"): label only - a revoked challenge serves nothing
 *   publicly
 *
 * Challenges are fully independent of one another (R17); the create-another
 * entry point sits at the top.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@components/ui/Button';
import { GlassIconButton } from '@components/ui/GlassIconButton';
import { Screen } from '@components/ui/Screen';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  confirmRevokeQuiz,
  useDeleteQuiz,
  useMyQuizzes,
  useRevokeQuiz,
  type QuizSummary,
} from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import type { RootStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';

import { QuizTopBar } from './components';
import { DURATION_FAST } from './components/motionTokens';
import { guessWhereMark } from './sampleAssets';

type Props = RootStackScreenProps<'MyQuizzes'>;

// Pre-play states: resumable and safely deletable (nothing is shared yet).
const DELETABLE_STATES = new Set(['building', 'awaiting_owner_play']);

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function metaLine(quiz: QuizSummary): string | null {
  const photoCount =
    quiz.question_count > 0
      ? `${quiz.question_count} ${quiz.question_count === 1 ? 'photo' : 'photos'}`
      : null;
  const score = quiz.score_to_beat
    ? `Score to beat: ${quiz.score_to_beat.correct} / ${quiz.score_to_beat.total}`
    : null;
  const parts = [photoCount, score].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The one action a card leads with, per lifecycle state. `key` doubles as the
 * testID slug the suite drives (`quiz-{key}-{id}`).
 */
function primaryActionFor(state: string): { key: string; label: string } | null {
  switch (state) {
    case 'building':
      return { key: 'resume', label: 'Resume' };
    case 'awaiting_owner_play':
      return { key: 'play', label: 'Play' };
    case 'playable':
      return { key: 'share', label: 'Share' };
    case 'shared':
      return { key: 'leaderboard', label: 'Leaderboard' };
    default:
      return null;
  }
}

/** Per-card mutation handlers, shared by the featured and compact layouts. */
function useQuizCardActions(quiz: QuizSummary, navigation: Props['navigation']) {
  const deleteMutation = useDeleteQuiz();
  const revokeMutation = useRevokeQuiz(quiz.id);

  const handlePrimary = useStableCallback(() => {
    switch (quiz.state) {
      case 'building':
        navigation.navigate('QuizCreation', { entryPoint: 'my_quizzes' });
        break;
      case 'awaiting_owner_play':
        navigation.navigate('QuizPlay', { quizId: quiz.id });
        break;
      case 'playable':
        // The results screen owns share (slug mint + share sheet).
        navigation.navigate('QuizResults', { quizId: quiz.id });
        break;
      case 'shared':
        navigation.navigate('QuizLeaderboard', { quizId: quiz.id });
        break;
    }
  });

  const handleDelete = useStableCallback(() => {
    if (deleteMutation.isPending) return;
    Alert.alert(
      'Delete challenge?',
      'This challenge and its photos are removed from our servers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMutation.mutate(
              { quizId: quiz.id, state: quiz.state },
              {
                onError: () => {
                  Alert.alert('Error', 'Could not delete the challenge. Please try again.');
                },
              }
            );
          },
        },
      ]
    );
  });

  // Same honest disclosure as the results screen's revoke (R15), via the
  // shared confirmation.
  const handleRevoke = useStableCallback(() => {
    if (revokeMutation.isPending) return;
    confirmRevokeQuiz(() => {
      revokeMutation.mutate(undefined, {
        onError: () => {
          Alert.alert('Error', 'Could not revoke the link. Please try again.');
        },
      });
    });
  });

  return { handlePrimary, handleDelete, handleRevoke };
}

/**
 * The card's single destructive action as an ellipsis. Each state has exactly
 * one (delete pre-play, revoke once shared), and the tap lands on the same
 * confirmation Alert the action has always used - so the glyph stays honest.
 */
function OverflowAction({
  quiz,
  onDelete,
  onRevoke,
}: {
  quiz: QuizSummary;
  onDelete: () => void;
  onRevoke: () => void;
}) {
  const deletable = DELETABLE_STATES.has(quiz.state);
  const revocable = quiz.state === 'shared';
  if (!deletable && !revocable) return null;
  return (
    <Pressable
      onPress={deletable ? onDelete : onRevoke}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={deletable ? 'Delete challenge' : 'Revoke link'}
      style={({ pressed }) => [styles.overflow, pressed && styles.pressedDim]}
      testID={deletable ? `quiz-delete-${quiz.id}` : `quiz-revoke-${quiz.id}`}
    >
      <Ionicons name="ellipsis-horizontal" size={20} color={colors.stormGray} />
    </Pressable>
  );
}

/** The chevron action row along a card's bottom edge. */
function ActionRow({ quiz, onPress }: { quiz: QuizSummary; onPress: () => void }) {
  const action = primaryActionFor(quiz.state);
  if (!action) return null;
  return (
    <>
      <View style={styles.divider} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.actionRow, pressed && styles.pressedDim]}
        testID={`quiz-${action.key}-${quiz.id}`}
      >
        <Text style={styles.actionLabel}>{action.label}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.stormGray} />
      </Pressable>
    </>
  );
}

/** The newest challenge, photo-first: cover on top, state pill over it. */
function FeaturedQuizCard({
  quiz,
  navigation,
}: {
  quiz: QuizSummary;
  navigation: Props['navigation'];
}) {
  const { handlePrimary, handleDelete, handleRevoke } = useQuizCardActions(quiz, navigation);
  const createdAt = formatCreatedAt(quiz.created_at);
  const meta = metaLine(quiz);

  const action = primaryActionFor(quiz.state);

  return (
    /* The whole card is the tap target for its primary action; the nested
       ellipsis and action row still win the touch when hit directly. A
       revoked challenge has no action, so it stays inert. */
    <Pressable
      onPress={action ? handlePrimary : undefined}
      disabled={!action}
      accessibilityRole={action ? 'button' : undefined}
      accessibilityLabel={action ? `${action.label} challenge` : undefined}
      style={({ pressed }) => [styles.featuredCard, pressed && action && styles.pressedDim]}
      testID={`quiz-row-${quiz.id}`}
    >
      <View style={styles.featuredPhotoFrame}>
        <Image
          source={{ uri: quiz.cover_image_url ?? undefined }}
          style={styles.featuredPhoto}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={DURATION_FAST}
          testID={`quiz-cover-${quiz.id}`}
        />
      </View>
      <View style={styles.featuredBody}>
        <View style={styles.featuredTitleRow}>
          <Text style={styles.featuredTitle}>{createdAt || 'Challenge'}</Text>
          <OverflowAction quiz={quiz} onDelete={handleDelete} onRevoke={handleRevoke} />
        </View>
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
        <ActionRow quiz={quiz} onPress={handlePrimary} />
      </View>
    </Pressable>
  );
}

/** The compact card: square thumbnail left, date + pill + action right. */
function QuizRow({ quiz, navigation }: { quiz: QuizSummary; navigation: Props['navigation'] }) {
  const { handlePrimary, handleDelete, handleRevoke } = useQuizCardActions(quiz, navigation);
  const createdAt = formatCreatedAt(quiz.created_at);
  const meta = metaLine(quiz);

  const action = primaryActionFor(quiz.state);

  return (
    <Pressable
      onPress={action ? handlePrimary : undefined}
      disabled={!action}
      accessibilityRole={action ? 'button' : undefined}
      accessibilityLabel={action ? `${action.label} challenge` : undefined}
      style={({ pressed }) => [styles.row, pressed && action && styles.pressedDim]}
      testID={`quiz-row-${quiz.id}`}
    >
      {quiz.cover_image_url ? (
        <Image
          source={{ uri: quiz.cover_image_url }}
          style={styles.rowThumb}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={DURATION_FAST}
          testID={`quiz-cover-${quiz.id}`}
        />
      ) : (
        // A draft with no photos yet keeps the frame so rows stay aligned.
        <View style={[styles.rowThumb, styles.rowThumbEmpty]} />
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle}>{createdAt || 'Challenge'}</Text>
          <OverflowAction quiz={quiz} onDelete={handleDelete} onRevoke={handleRevoke} />
        </View>
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
        <ActionRow quiz={quiz} onPress={handlePrimary} />
      </View>
    </Pressable>
  );
}

export function MyQuizzesScreen({ navigation, route }: Props) {
  const { data: quizzes, isLoading, isError, refetch } = useMyQuizzes();
  const entryPoint = route.params?.entryPoint ?? 'unknown';

  // Track screen view once the list settles, so the counts are real rather
  // than a snapshot of the loading state. Fires once per mount - the ref
  // guard matters because this screen is returned to from four destinations.
  const viewFiredRef = useRef(false);
  useEffect(() => {
    if (viewFiredRef.current || isLoading) return;
    viewFiredRef.current = true;
    const list = quizzes ?? [];
    Analytics.viewMyQuizzes({
      entryPoint,
      quizCount: list.length,
      sharedCount: list.filter((quiz) => quiz.state === 'shared').length,
      draftCount: list.filter((quiz) => DELETABLE_STATES.has(quiz.state)).length,
      loadFailed: isError,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isError, quizzes]);

  const handleCreate = useStableCallback(() => {
    navigation.navigate('QuizCreation', { entryPoint: 'my_quizzes' });
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  const handleHowItWorks = useStableCallback(() => {
    navigation.navigate('GuessWhereIntro', { entryPoint: 'my_quizzes' });
  });

  return (
    /* safeArea={false}: QuizTopBar applies the top inset itself, and Screen's
       SafeAreaView would apply it a second time. */
    <Screen safeArea={false}>
      <QuizTopBar
        title="Guess Where"
        onClose={handleBack}
        variant="light"
        testID="quiz-list-top-bar"
        rightActions={
          <>
            <GlassIconButton
              icon="help-circle-outline"
              onPress={handleHowItWorks}
              accessibilityLabel="How it works"
              testID="quiz-how-it-works"
            />
            <GlassIconButton
              icon="add"
              onPress={handleCreate}
              accessibilityLabel="New challenge"
              testID="quiz-create-new"
            />
          </>
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.sunsetGold} />
          </View>
        ) : isError ? (
          <View style={styles.errorState} testID="quiz-list-error">
            <Text style={styles.body}>
              We could not load your challenges right now. Please try again.
            </Text>
            <Button title="Try Again" variant="ghost" onPress={() => refetch()} />
          </View>
        ) : !quizzes || quizzes.length === 0 ? (
          <View style={styles.emptyState} testID="quiz-list-empty">
            <Image
              source={guessWhereMark}
              style={styles.emptyIllustration}
              contentFit="contain"
              testID="quiz-empty-mark"
            />
            <Text style={styles.emptyTitle}>No challenges yet</Text>
            <Text style={styles.body}>See if your friends can guess where you have been.</Text>
          </View>
        ) : (
          quizzes.map((quiz, index) =>
            index === 0 && quiz.cover_image_url ? (
              <FeaturedQuizCard key={quiz.id} quiz={quiz} navigation={navigation} />
            ) : (
              <QuizRow key={quiz.id} quiz={quiz} navigation={navigation} />
            )
          )
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  loading: {
    paddingVertical: 32,
  },
  errorState: {
    paddingVertical: 24,
    gap: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyIllustration: {
    width: 140,
    height: 140,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  featuredCard: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  featuredPhotoFrame: {
    height: 220,
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
  featuredPhoto: {
    ...StyleSheet.absoluteFillObject,
  },
  featuredBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 6,
  },
  featuredTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  featuredTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 26,
    lineHeight: 32,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 14,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  rowThumb: {
    width: 96,
    height: 96,
    borderRadius: 14,
  },
  rowThumbEmpty: {
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
  rowBody: {
    flex: 1,
    gap: 5,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 19,
    lineHeight: 25,
    color: colors.textPrimary,
  },
  rowMeta: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.midnightNavyBorder,
    marginTop: 8,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  actionLabel: {
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  overflow: {
    padding: 2,
  },
  pressedDim: {
    opacity: 0.6,
  },
});
