import { useCallback, useEffect, useState } from 'react';

import { useSendInvite, useTripPendingInvites } from './useInvites';
import {
  useAddTripTag,
  useCreateTrip,
  useRemoveTripTag,
  useTrip,
  useUpdateTrip,
} from './useTrips';

export interface UseTripFormOptions {
  tripId?: string;
}

export interface TripFormState {
  name: string;
  coverImageUrl: string;
  selectedFriendIds: Set<string>;
  invitedEmails: Set<string>;
}

export interface TripFormValidation {
  nameError: string;
  countryError: string;
}

export interface UseTripFormResult {
  // Form state
  name: string;
  setName: (value: string) => void;
  coverImageUrl: string;
  setCoverImageUrl: (value: string) => void;

  // Friend tagging state
  selectedFriendIds: Set<string>;
  invitedEmails: Set<string>;
  handleToggleFriend: (userId: string) => void;
  handleToggleEmailInvite: (email: string) => void;

  // Validation
  nameError: string;
  setNameError: (value: string) => void;
  countryError: string;
  setCountryError: (value: string) => void;
  validate: (countryCode: string | null) => boolean;

  // Loading states
  isLoading: boolean;
  isFetching: boolean;

  // Actions
  handleSave: (countryCode: string | null, onSuccess: (tripId?: string) => void) => Promise<void>;

  // Mode
  isEditing: boolean;
}

/**
 * Hook for managing trip form state and save logic.
 * Handles create/update mutations, friend tagging, and email invites.
 */
export function useTripForm(options: UseTripFormOptions = {}): UseTripFormResult {
  const { tripId } = options;
  const isEditing = !!tripId;

  // Form state
  const [name, setName] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');

  // Validation state
  const [nameError, setNameError] = useState('');
  const [countryError, setCountryError] = useState('');

  // Tagged friends state
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [invitedEmails, setInvitedEmails] = useState<Set<string>>(new Set());
  const [originalTaggedIds, setOriginalTaggedIds] = useState<Set<string>>(new Set());
  const [originalInvitedEmails, setOriginalInvitedEmails] = useState<Set<string>>(new Set());

  // Fetch existing trip if editing
  const { data: existingTrip, isLoading: loadingTrip } = useTrip(tripId || '');

  // Fetch pending email invites for this trip
  const { data: pendingInvites, isLoading: loadingInvites } = useTripPendingInvites(tripId);

  // Mutations
  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTrip();
  const sendInvite = useSendInvite();
  const addTripTag = useAddTripTag();
  const removeTripTag = useRemoveTripTag();

  // Populate form when editing
  useEffect(() => {
    if (existingTrip && isEditing) {
      setName(existingTrip.name);
      setCoverImageUrl(existingTrip.cover_image_url || '');
      if (existingTrip.tags && existingTrip.tags.length > 0) {
        const taggedIds = new Set(existingTrip.tags.map((tag) => tag.tagged_user_id));
        setSelectedFriendIds(taggedIds);
        setOriginalTaggedIds(taggedIds);
      }
    }
  }, [existingTrip, isEditing]);

  // Populate pending email invites when editing
  useEffect(() => {
    if (pendingInvites && pendingInvites.length > 0 && isEditing) {
      const emails = new Set(pendingInvites.map((inv) => inv.email));
      setInvitedEmails(emails);
      setOriginalInvitedEmails(emails);
    }
  }, [pendingInvites, isEditing]);

  const handleToggleFriend = useCallback((userId: string) => {
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const handleToggleEmailInvite = useCallback((email: string) => {
    setInvitedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  }, []);

  const validate = useCallback(
    (countryCode: string | null): boolean => {
      let isValid = true;

      // Name is required
      if (!name.trim()) {
        setNameError('Trip name is required');
        isValid = false;
      } else {
        setNameError('');
      }

      // Country is required for new trips
      if (!isEditing && !countryCode) {
        setCountryError('Please select a country');
        isValid = false;
      } else {
        setCountryError('');
      }

      return isValid;
    },
    [name, isEditing]
  );

  const handleSave = useCallback(
    async (countryCode: string | null, onSuccess: (tripId?: string) => void) => {
      if (!validate(countryCode)) return;

      try {
        if (isEditing && tripId) {
          // Update existing trip
          await updateTrip.mutateAsync({
            id: tripId,
            name: name.trim(),
            cover_image_url: coverImageUrl.trim() || undefined,
          });

          // Handle tag changes
          const tagsToAdd = Array.from(selectedFriendIds).filter(
            (id) => !originalTaggedIds.has(id)
          );
          const tagsToRemove = Array.from(originalTaggedIds).filter(
            (id) => !selectedFriendIds.has(id)
          );

          // Add new tags and remove old tags
          const addPromises = tagsToAdd.map((taggedUserId) =>
            addTripTag.mutateAsync({ tripId, taggedUserId })
          );
          const removePromises = tagsToRemove.map((taggedUserId) =>
            removeTripTag.mutateAsync({ tripId, taggedUserId })
          );
          await Promise.allSettled([...addPromises, ...removePromises]);

          // Send email invites for NEW non-platform users only (not already pending)
          const newEmailInvites = Array.from(invitedEmails).filter(
            (email) => !originalInvitedEmails.has(email)
          );
          if (newEmailInvites.length > 0) {
            const invitePromises = newEmailInvites.map((email) =>
              sendInvite.mutateAsync({
                email,
                invite_type: 'trip_tag',
                trip_id: tripId,
              })
            );
            await Promise.allSettled(invitePromises);
          }

          onSuccess();
        } else {
          // Create new trip
          const newTrip = await createTrip.mutateAsync({
            name: name.trim(),
            country_code: countryCode!,
            cover_image_url: coverImageUrl.trim() || undefined,
            tagged_user_ids:
              selectedFriendIds.size > 0 ? Array.from(selectedFriendIds) : undefined,
          });

          // Send email invites for non-platform users
          if (invitedEmails.size > 0) {
            const invitePromises = Array.from(invitedEmails).map((email) =>
              sendInvite.mutateAsync({
                email,
                invite_type: 'trip_tag',
                trip_id: newTrip.id,
              })
            );
            await Promise.allSettled(invitePromises);
          }

          onSuccess(newTrip.id);
        }
      } catch {
        // Error is handled by the mutation's onError
      }
    },
    [
      validate,
      isEditing,
      tripId,
      name,
      coverImageUrl,
      selectedFriendIds,
      originalTaggedIds,
      invitedEmails,
      originalInvitedEmails,
      updateTrip,
      addTripTag,
      removeTripTag,
      sendInvite,
      createTrip,
    ]
  );

  const isLoading =
    createTrip.isPending ||
    updateTrip.isPending ||
    sendInvite.isPending ||
    addTripTag.isPending ||
    removeTripTag.isPending;

  const isFetching = (loadingTrip || loadingInvites) && isEditing;

  return {
    name,
    setName,
    coverImageUrl,
    setCoverImageUrl,
    selectedFriendIds,
    invitedEmails,
    handleToggleFriend,
    handleToggleEmailInvite,
    nameError,
    setNameError,
    countryError,
    setCountryError,
    validate,
    isLoading,
    isFetching,
    handleSave,
    isEditing,
  };
}
