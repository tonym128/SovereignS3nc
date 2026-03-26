export interface FollowedUser {
  userId: string;
  lastSync: string;
  publicKey: string;
}

export interface IStorage {
  init(): Promise<void>;
  
  /**
   * Get the content of a daily SQLite database file.
   * @param date ISO date string (YYYY-MM-DD)
   * @param type 'private' or 'public'
   */
  getDailyDb(date: string, type: 'private' | 'public'): Promise<Uint8Array | null>;

  /**
   * Save content to a daily SQLite database file.
   * @param date ISO date string (YYYY-MM-DD)
   * @param type 'private' or 'public'
   * @param data The binary content of the SQLite file
   */
  saveDailyDb(date: string, type: 'private' | 'public', data: Uint8Array): Promise<void>;

  /**
   * Delete a daily SQLite database file.
   */
  deleteDailyDb(date: string, type: 'private' | 'public'): Promise<void>;

  /**
   * Calculate/Get the hash of the local daily DB file.
   */
  getDailyDbHash(date: string, type: 'private' | 'public'): Promise<string | null>;

  /**
   * Get the public user ID file content.
   */
  getPublicUserFile(): Promise<Uint8Array | null>;

  /**
   * Save the public user ID file content.
   */
  savePublicUserFile(data: Uint8Array): Promise<void>;

  /**
   * Get generic file content.
   */
  getFile(path: string): Promise<Uint8Array | null>;

  /**
   * Save generic file content.
   */
  saveFile(path: string, data: Uint8Array): Promise<void>;

  /**
   * Delete generic file.
   */
  deleteFile(path: string): Promise<void>;

  /**
   * Get the modification timestamp of a file.
   */
  getFileTimestamp(path: string): Promise<number | null>;

  /**
   * List all files in a prefix.
   */
  listFiles(prefix: string): Promise<string[]>;

  /**
   * Get the cached hash of what we believe is on the remote for a generic file.
   */
  getGenericRemoteHashCache(path: string): Promise<string | null>;

  /**
   * Update the cached hash of the remote file for a generic file.
   */
  setGenericRemoteHashCache(path: string, hash: string): Promise<void>;

  /**
   * Get the cached hash of what we believe is on the remote.
   */
  getRemoteHashCache(date: string, type: 'private' | 'public'): Promise<string | null>;

  /**
   * Update the cached hash of the remote file.
   */
  setRemoteHashCache(date: string, type: 'private' | 'public', hash: string): Promise<void>;

    /**

     * Get the date of the last successful sync check.

     */

    getLastSyncDate(): Promise<string | null>;

  

    /**

     * Set the date of the last successful sync check.

     */

    setLastSyncDate(date: string): Promise<void>;

  

      /**

  

       * Save a public DB from another user.

  

       */

  

      saveFollowedDb(userId: string, date: string, data: Uint8Array): Promise<void>;

  

    

  

      /**

  

       * Get the hash of a followed user's DB.

  

       */

  

      getFollowedDbHash(userId: string, date: string): Promise<string | null>;

  

    

  

      /**

  

       * Get the list of users we are following.
     */
    getFollowing(): Promise<FollowedUser[]>;

    /**
     * Add a user to the following list.
     */
    followUser(userId: string, lastSync: string, publicKey: string): Promise<void>;

    /**
     * Remove a user from the following list.
     */
    unfollowUser(userId: string): Promise<void>;

    /**
     * Update the last sync date for a followed user.
     */
    updateFollowedUserSync(userId: string, date: string): Promise<void>;
  }

  