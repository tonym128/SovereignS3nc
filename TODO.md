TODO
- Ability to delete posts and comments (leave a 'deleted' message if there are replies)
- Allow a user to clear their local and remote data on the profile screen
- Allow a user to export a backup of their data and a backup of their profile details, should they wish to log in from other devices.
- Performance testing of Garage
- Security tests of garage to make sure it's not allowing listing
- Tests on OCI PAR to make sure that it's working correctly
- Allow a user to clear all their local data from the connection page

- When a user deletes a post it should be deleted from the public index, it should be marked deleted and the data cleared and on sync other users should pick up and remove the post from their local store.
- When doing a sync, check for new users to follow
- On the network page show the users names and profile photos
- On the networks page remove the My Soveriegn Address.
- Add the idea of a read only anonymous user with no write access or profile and show the main public feed, this should be feature flagged and shown on the login page as an option if enabled.
- Periodic sync ?

DONE
- The list function should never be used anywhere in SovereignS3nc as security relies on unknown locations in S3 or OCI. For instance the friends list should be fetched from a known location, any user who logs in should be able to add anyone on the server as a follow from the public index, removal is the same as well. Rely on eventual consistency, when downloading the user list for the server, make sure the current user is in there and add them if required.
- All references in the server should only point to the local instance
- Friends should be followed by name alone, no s3 url, it's all on the local server, use the users public guid from the users index to follow them.
- When a user publicly posts their public post should use the public guid.
- Nothing in the public share should reference anything in a users folder or their private guid, only the public one, any items required should be in the public folder (user images, post image, etc, duplication of files is fine)
- Show the users public and private guid on the profile page
- When a user logs in they should be assigned a public and private guid and allowed to input it when logging in, if it's known
- If a user logs in using their private guid (optional) it has to already exist for them to log in.
- Social network demo in docker build should be set to have the correct config details and the correct credentials.
- When the tab is shown in the social network demo for connection it's set to s3 but is showing the par screen.
- Use ETags to check for changes on content
